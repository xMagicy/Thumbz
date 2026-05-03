import {
  db,
  thumbnailsTable,
  viewSnapshotsTable,
  type Thumbnail,
} from "@workspace/db";
import { and, eq, sql, lt, gte, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

/**
 * YouTube sourcing v2 — Blok A + E + F (per herziening brief).
 *
 *   1. mostPopular.list across 12 regions          → globally trending
 *   2. search.list per under-served category       → cold-start fillers
 *   3. videos.list to enrich search hits           → snippet+stats+contentDetails
 *   4. channels.list to fetch subscriberCount      → drives overperformer ratio
 *   5. Quality gate (recency, duration, views,
 *      engagement, overperformer, channel-name
 *      patterns, lyric exclusion, maxres-only)
 *   6. Hybrid classifier (categoryId + title
 *      keywords + channel patterns) → app_category
 *   7. Channel cap (≤2 per channelId)
 *   8. Topic diversity (Jaccard < 0.4 cluster cap 5)
 *   9. Region balance (≤25% per primary region)
 *  10. Upsert + view-snapshot
 *  11. Category balance archive (≤20% per category)
 *
 * Quota math (per sync run):
 *   12 mostPopular        ×   1 unit   =  12
 *    4 search.list        × 100 units  = 400
 *    4 videos.list (enrich)× 1 unit    =   4
 *   ~600 channels in batches of 50 → 12 calls × 1 = 12
 *   Total ≈ 428 units / sync × 4 syncs/day = 1712 / 10000 daily quota.
 */

const YT_BASE = "https://www.googleapis.com/youtube/v3";

const REGIONS = [
  "US", "GB", "IN", "BR", "JP", "DE",
  "KR", "MX", "FR", "CA", "AU", "ID",
] as const;

// Targeted search queries to fill structurally under-represented buckets.
// Each entry is one search.list call (100 quota units). Keep the list
// short — the most expensive part of the sync.
const TARGETED_SEARCHES: Array<{
  category: string;
  q: string;
  videoCategoryId?: string;
}> = [
  { category: "Finance", q: "investing OR stocks OR money OR crypto" },
  { category: "Lifestyle", q: "morning routine OR aesthetic OR day in my life" },
  { category: "Tutorial", q: "how to OR tutorial", videoCategoryId: "26" },
];

// Channel-name pattern blocklist. These channels are usually labels /
// movie studios where the brand pulls the views, not the thumbnail.
const CHANNEL_NAME_BLOCKLIST = /\b(VEVO|Records|Films|Studios|Pictures|Network)\b/i;

// Excluded YouTube category IDs. cat 1 = Film & Animation (movie trailers).
const EXCLUDED_CATEGORIES = new Set(["1"]);

// Finance channels that classify as Finance regardless of title keywords.
const FINANCE_CHANNELS = new Set(
  [
    "Graham Stephan",
    "Andrei Jikh",
    "Coffeezilla",
    "How Money Works",
    "The Plain Bagel",
    "Patrick Boyle",
  ].map((s) => s.toLowerCase()),
);

interface YtThumbnail {
  url: string;
  width?: number;
  height?: number;
}

interface YtVideo {
  id: string;
  snippet?: {
    publishedAt: string;
    title: string;
    channelId: string;
    channelTitle: string;
    categoryId?: string;
    thumbnails?: {
      default?: YtThumbnail;
      medium?: YtThumbnail;
      high?: YtThumbnail;
      standard?: YtThumbnail;
      maxres?: YtThumbnail;
    };
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
}

interface YtListResponse {
  items?: YtVideo[];
  error?: { code: number; message: string };
}

interface YtSearchItem {
  id: { kind: string; videoId?: string };
}

interface YtSearchResponse {
  items?: YtSearchItem[];
  error?: { code: number; message: string };
}

interface YtChannel {
  id: string;
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
}

interface YtChannelsResponse {
  items?: YtChannel[];
  error?: { code: number; message: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + s;
}

function pickMaxresThumbnail(v: YtVideo): string | null {
  // Brief A: skip if maxres ontbreekt. Maxres-only, no fallback.
  return v.snippet?.thumbnails?.maxres?.url ?? null;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "you", "your", "are", "but",
  "from", "all", "his", "her", "they", "them", "was", "not", "have", "has",
  "official", "video", "trailer", "ft", "feat",
]);

function tokenize(title: string): Set<string> {
  const matches = title.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) ?? [];
  return new Set(matches.filter((t) => !STOP_WORDS.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─── Hybrid classifier (Blok E) ───────────────────────────────────────
//
// Order matters: Gaming → Music → Tech → Finance → Tutorial → Lifestyle
// → Vlog → Other. First match wins.
function classify(v: YtVideo): string {
  const snippet = v.snippet;
  if (!snippet) return "Other";
  const title = snippet.title?.toLowerCase() ?? "";
  const channel = snippet.channelTitle?.toLowerCase() ?? "";
  const cat = snippet.categoryId;

  const hasAny = (...terms: string[]) => terms.some((t) => title.includes(t));

  if (
    cat === "20" ||
    hasAny(
      "minecraft", "fortnite", "gameplay", "speedrun", "let's play",
      "playthrough", "boss fight",
    )
  ) {
    return "Gaming";
  }

  if (cat === "10") {
    if (title.includes("lyric")) return "Other"; // auto-generated thumbs
    return "Music";
  }

  if (
    cat === "28" ||
    hasAny(
      "iphone", "android", "macbook", "review", "unboxing", " vs ",
      "tech", " ai ", "gpu", "cpu",
    )
  ) {
    return "Tech";
  }

  if (
    FINANCE_CHANNELS.has(channel) ||
    hasAny(
      "stocks", "investing", "money", "dividend", "s&p", "bitcoin", "crypto",
      "etf", "passive income", "wealth", "millionaire", "broke", "salary",
      "rent", "mortgage",
    )
  ) {
    return "Finance";
  }

  if (
    cat === "26" || cat === "27" ||
    hasAny("how to", "tutorial", "guide", "learn", "step by step", "explained")
  ) {
    return "Tutorial";
  }

  if (
    cat === "22" ||
    hasAny(
      "morning routine", "day in my life", "outfit", "skincare", "fitness",
      "diet", "minimalism", "decluttering",
    )
  ) {
    if (
      cat === "22" &&
      hasAny("vlog", "trip", "moving", "life update")
    ) {
      // Falls through to Vlog branch below.
    } else {
      return "Lifestyle";
    }
  }

  if (
    (cat === "22" || cat === "24") &&
    hasAny("vlog", "day", "trip", "moving", "life update")
  ) {
    return "Vlog";
  }

  return "Other";
}

// ─── Quality gate (Blok A) ────────────────────────────────────────────

const NOW_TS = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

interface CandidateMeta {
  video: YtVideo;
  primaryRegion: string;        // first region we saw it in this sync
  trendingRegions: Set<string>; // all regions where it trended
  fromSearch: boolean;
}

function passesPreClassifierFilters(
  v: YtVideo,
  subscriberCount: number | null,
): string | null {
  const snippet = v.snippet;
  const stats = v.statistics;
  if (!snippet || !stats) return "missing_metadata";
  if (snippet.categoryId && EXCLUDED_CATEGORIES.has(snippet.categoryId)) {
    return "excluded_category";
  }
  if (snippet.channelTitle && CHANNEL_NAME_BLOCKLIST.test(snippet.channelTitle)) {
    return "channel_blocklist";
  }
  if (!pickMaxresThumbnail(v)) return "no_maxres";

  const publishedAt = new Date(snippet.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return "bad_publish_date";
  const ageMs = NOW_TS() - publishedAt;
  if (ageMs > 14 * DAY_MS) return "too_old";
  if (ageMs < 0) return "future_publish_date";

  const durationSec = parseIsoDuration(v.contentDetails?.duration);
  if (durationSec === null) return "no_duration";
  if (durationSec < 60) return "short_form";

  const views = Number(stats.viewCount);
  if (!Number.isFinite(views) || views < 25_000) return "below_min_views";

  const likes = Number(stats.likeCount);
  if (!Number.isFinite(likes)) return "no_like_count";
  const engagement = likes / views;
  if (engagement < 0.02) return "low_engagement";

  if (subscriberCount === null || subscriberCount === 0) {
    // Hidden / zero subs → can't compute overperformer ratio. Skip
    // rather than divide by zero. Channels that hide their sub count
    // are uncommon in trending and often spam aggregators anyway.
    return "no_subscriber_count";
  }
  const ratio = views / subscriberCount;
  if (ratio < 1.0) return "below_overperform_ratio";

  return null;
}

// ─── API fetchers ─────────────────────────────────────────────────────

async function fetchJson<T>(url: URL): Promise<T> {
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as T & { error?: { code: number; message: string } };
  if (data.error) {
    throw new Error(`YouTube API error ${data.error.code}: ${data.error.message}`);
  }
  return data;
}

async function fetchMostPopular(apiKey: string, region: string): Promise<YtVideo[]> {
  const url = new URL(`${YT_BASE}/videos`);
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", region);
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("key", apiKey);
  const data = await fetchJson<YtListResponse>(url);
  return data.items ?? [];
}

async function fetchSearchVideoIds(
  apiKey: string,
  q: string,
  videoCategoryId: string | undefined,
): Promise<string[]> {
  const url = new URL(`${YT_BASE}/search`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "viewCount");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("q", q);
  // Last 14 days, ISO 8601.
  const after = new Date(Date.now() - 14 * DAY_MS).toISOString();
  url.searchParams.set("publishedAfter", after);
  if (videoCategoryId) url.searchParams.set("videoCategoryId", videoCategoryId);
  url.searchParams.set("key", apiKey);
  const data = await fetchJson<YtSearchResponse>(url);
  return (data.items ?? [])
    .map((it) => it.id.videoId)
    .filter((id): id is string => Boolean(id));
}

async function fetchVideosByIds(apiKey: string, ids: string[]): Promise<YtVideo[]> {
  if (ids.length === 0) return [];
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/videos`);
    url.searchParams.set("part", "snippet,statistics,contentDetails");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const data = await fetchJson<YtListResponse>(url);
    out.push(...(data.items ?? []));
  }
  return out;
}

async function fetchChannelSubs(
  apiKey: string,
  channelIds: string[],
): Promise<Map<string, number>> {
  const subs = new Map<string, number>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/channels`);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const data = await fetchJson<YtChannelsResponse>(url);
    for (const ch of data.items ?? []) {
      if (ch.statistics?.hiddenSubscriberCount) {
        subs.set(ch.id, 0);
        continue;
      }
      const n = Number(ch.statistics?.subscriberCount);
      if (Number.isFinite(n)) subs.set(ch.id, n);
    }
  }
  return subs;
}

// ─── Sync orchestration ───────────────────────────────────────────────

interface SyncResult {
  region: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface SyncSummary {
  ok: boolean;
  reason?: string;
  results: SyncResult[];
  totalCandidates?: number;
  totalAccepted?: number;
  totalArchivedByBalance?: number;
}

export async function syncTrendingVideos(opts?: {
  regions?: string[];
  maxResults?: number; // accepted for backward-compat with admin route
}): Promise<SyncSummary> {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    logger.warn(
      "YOUTUBE_API_KEY not set — skipping trending sync. Real user data continues unaffected.",
    );
    return { ok: false, reason: "missing_api_key", results: [] };
  }

  const regions = opts?.regions ?? [...REGIONS];

  // ── Phase 1: fetch all sources in parallel ───────────────────────
  const candidates = new Map<string, CandidateMeta>();
  const popularSettled = await Promise.allSettled(
    regions.map(async (region) => ({ region, items: await fetchMostPopular(apiKey, region) })),
  );
  for (const r of popularSettled) {
    if (r.status === "rejected") {
      logger.error({ err: r.reason }, "mostPopular fetch failed");
      continue;
    }
    const { region, items } = r.value;
    for (const v of items) {
      if (!v.id) continue;
      const existing = candidates.get(v.id);
      if (existing) {
        existing.trendingRegions.add(region);
      } else {
        candidates.set(v.id, {
          video: v,
          primaryRegion: region,
          trendingRegions: new Set([region]),
          fromSearch: false,
        });
      }
    }
  }

  // Targeted search for under-served buckets.
  for (const search of TARGETED_SEARCHES) {
    try {
      const ids = await fetchSearchVideoIds(apiKey, search.q, search.videoCategoryId);
      const newIds = ids.filter((id) => !candidates.has(id));
      if (newIds.length === 0) continue;
      const enriched = await fetchVideosByIds(apiKey, newIds);
      for (const v of enriched) {
        if (!v.id || candidates.has(v.id)) continue;
        candidates.set(v.id, {
          video: v,
          primaryRegion: "SEARCH",
          trendingRegions: new Set(),
          fromSearch: true,
        });
      }
    } catch (err) {
      logger.error({ err, q: search.q }, "Targeted search failed");
    }
  }

  // ── Phase 2: enrich with subscriber counts ────────────────────────
  const channelIds = Array.from(
    new Set(
      Array.from(candidates.values())
        .map((c) => c.video.snippet?.channelId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  let subs: Map<string, number>;
  try {
    subs = await fetchChannelSubs(apiKey, channelIds);
  } catch (err) {
    logger.error({ err }, "channels.list failed — overperformer filter will reject all");
    subs = new Map();
  }

  // ── Phase 3: filter through quality gate + classify ───────────────
  interface Accepted {
    meta: CandidateMeta;
    subscriberCount: number;
    viewCount: number;
    appCategory: string;
    titleTokens: Set<string>;
  }
  const totalCandidates = candidates.size;
  const accepted: Accepted[] = [];
  const skipReasons = new Map<string, number>();

  for (const meta of candidates.values()) {
    const channelId = meta.video.snippet?.channelId;
    const subscriberCount = channelId ? subs.get(channelId) ?? null : null;
    const reason = passesPreClassifierFilters(meta.video, subscriberCount);
    if (reason) {
      skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
      continue;
    }
    const appCategory = classify(meta.video);
    accepted.push({
      meta,
      subscriberCount: subscriberCount ?? 0,
      viewCount: Number(meta.video.statistics?.viewCount ?? 0),
      appCategory,
      titleTokens: tokenize(meta.video.snippet?.title ?? ""),
    });
  }

  // ── Phase 4: Topic diversity (Jaccard < 0.4 cluster cap = 5) ─────
  // Per category, sort by overperformer ratio DESC. Greedy cluster
  // assignment: a video joins the first cluster it overlaps; if that
  // cluster already has 5 members, the video is dropped.
  const byCategory = new Map<string, Accepted[]>();
  for (const a of accepted) {
    const list = byCategory.get(a.appCategory) ?? [];
    list.push(a);
    byCategory.set(a.appCategory, list);
  }
  const diversityFiltered: Accepted[] = [];
  for (const list of byCategory.values()) {
    list.sort((x, y) => {
      const rx = x.subscriberCount > 0 ? x.viewCount / x.subscriberCount : 0;
      const ry = y.subscriberCount > 0 ? y.viewCount / y.subscriberCount : 0;
      return ry - rx;
    });
    const clusters: Array<{ tokens: Set<string>; members: Accepted[] }> = [];
    for (const cand of list) {
      let placed = false;
      for (const cluster of clusters) {
        if (jaccard(cand.titleTokens, cluster.tokens) > 0.4) {
          if (cluster.members.length < 5) {
            cluster.members.push(cand);
            for (const t of cand.titleTokens) cluster.tokens.add(t);
          }
          // else: drop (cluster full)
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push({ tokens: new Set(cand.titleTokens), members: [cand] });
      }
    }
    for (const c of clusters) diversityFiltered.push(...c.members);
  }

  // ── Phase 5: Channel cap (max 2 per channelId) ───────────────────
  diversityFiltered.sort((x, y) => {
    const rx = x.subscriberCount > 0 ? x.viewCount / x.subscriberCount : 0;
    const ry = y.subscriberCount > 0 ? y.viewCount / y.subscriberCount : 0;
    return ry - rx;
  });
  const perChannel = new Map<string, number>();
  const channelCapped: Accepted[] = [];
  for (const a of diversityFiltered) {
    const ch = a.meta.video.snippet?.channelId ?? "?";
    const n = perChannel.get(ch) ?? 0;
    if (n >= 2) continue;
    perChannel.set(ch, n + 1);
    channelCapped.push(a);
  }

  // ── Phase 6: Region balance (≤25% per primary region) ────────────
  const total = channelCapped.length;
  const cap = Math.max(1, Math.floor(total * 0.25));
  const perRegion = new Map<string, number>();
  const regionBalanced: Accepted[] = [];
  for (const a of channelCapped) {
    const region = a.meta.primaryRegion;
    if (region === "SEARCH") {
      regionBalanced.push(a); // search hits aren't region-attributable
      continue;
    }
    const n = perRegion.get(region) ?? 0;
    if (n >= cap) continue;
    perRegion.set(region, n + 1);
    regionBalanced.push(a);
  }

  // ── Phase 7: Upsert + view snapshot ──────────────────────────────
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  for (const a of regionBalanced) {
    try {
      const v = a.meta.video;
      const snippet = v.snippet!;
      const videoId = v.id;
      const imageUrl = pickMaxresThumbnail(v)!;
      const publishedAt = new Date(snippet.publishedAt);
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const trendingArr = Array.from(a.meta.trendingRegions);
      const ratio = a.subscriberCount > 0 ? a.viewCount / a.subscriberCount : null;
      const categoryIdInt = snippet.categoryId ? Number(snippet.categoryId) : null;

      const [existing] = await db
        .select()
        .from(thumbnailsTable)
        .where(eq(thumbnailsTable.youtubeVideoId, videoId))
        .limit(1);

      let thumbnailId: number;
      let prevViewCount: number | null = null;
      let prevCapturedAt: Date | null = null;

      if (existing) {
        thumbnailId = existing.id;
        const [lastSnap] = await db
          .select()
          .from(viewSnapshotsTable)
          .where(eq(viewSnapshotsTable.thumbnailId, existing.id))
          .orderBy(sql`${viewSnapshotsTable.capturedAt} DESC`)
          .limit(1);
        if (lastSnap) {
          prevViewCount = lastSnap.viewCount;
          prevCapturedAt = lastSnap.capturedAt;
        }
      } else {
        const [ins] = await db
          .insert(thumbnailsTable)
          .values({
            title: snippet.title,
            imageUrl,
            channelName: snippet.channelTitle,
            niche: a.appCategory, // mirror app_category for legacy UI
            appCategory: a.appCategory,
            categoryId: Number.isFinite(categoryIdInt) ? categoryIdInt : null,
            youtubeUrl,
            status: "active",
            archived: false,
            source: "youtube",
            youtubeVideoId: videoId,
            viewCount: a.viewCount,
            subscriberCount: a.subscriberCount || null,
            viewToSubRatio: ratio,
            publishedAt,
            lastSyncedAt: now,
            trendingRegions: trendingArr.length > 0 ? trendingArr : null,
          })
          .returning({ id: thumbnailsTable.id });
        if (!ins) continue;
        thumbnailId = ins.id;
        inserted += 1;
      }

      let viewVelocity: number | null = existing?.viewVelocity ?? null;
      if (prevViewCount !== null && prevCapturedAt) {
        const hours = (now.getTime() - prevCapturedAt.getTime()) / (1000 * 60 * 60);
        if (hours > 0) {
          const delta = a.viewCount - prevViewCount;
          viewVelocity = Math.max(0, delta / hours);
        }
      }

      if (existing) {
        await db
          .update(thumbnailsTable)
          .set({
            title: snippet.title,
            channelName: snippet.channelTitle,
            niche: a.appCategory,
            appCategory: a.appCategory,
            categoryId: Number.isFinite(categoryIdInt) ? categoryIdInt : null,
            imageUrl,
            youtubeUrl,
            viewCount: a.viewCount,
            viewVelocity,
            subscriberCount: a.subscriberCount || null,
            viewToSubRatio: ratio,
            publishedAt,
            lastSyncedAt: now,
            trendingRegions: trendingArr.length > 0 ? trendingArr : null,
            // Re-activate if a previously archived video makes the cut again.
            archived: false,
          })
          .where(eq(thumbnailsTable.id, thumbnailId));
        updated += 1;
      }

      await db.insert(viewSnapshotsTable).values({
        thumbnailId,
        viewCount: a.viewCount,
        capturedAt: now,
      });
    } catch (err) {
      logger.error({ err, videoId: a.meta.video.id }, "Failed to upsert YouTube video");
    }
  }

  // ── Phase 8: Category balance archive (cap 20% per category) ─────
  const totalArchivedByBalance = await enforceCategoryBalance();

  logger.info(
    {
      regions: regions.length,
      candidates: totalCandidates,
      accepted: accepted.length,
      afterDiversity: diversityFiltered.length,
      afterChannelCap: channelCapped.length,
      afterRegionBalance: regionBalanced.length,
      inserted,
      updated,
      archivedByBalance: totalArchivedByBalance,
      skipReasons: Object.fromEntries(skipReasons),
    },
    "YouTube sync v2 completed",
  );

  return {
    ok: true,
    results: regions.map((r) => ({
      region: r,
      fetched: 0, // not tracked per-region in v2 (parallel collection)
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    })),
    totalCandidates,
    totalAccepted: regionBalanced.length,
    totalArchivedByBalance,
  };
}

/**
 * Blok F: enforce ≤20% per app_category among active YouTube rows.
 * For any over-cap category, archive the lowest-ELO rows until at cap.
 * Returns the total number of rows newly archived.
 */
async function enforceCategoryBalance(): Promise<number> {
  const rows = await db
    .select()
    .from(thumbnailsTable)
    .where(
      and(
        eq(thumbnailsTable.archived, false),
        eq(thumbnailsTable.source, "youtube"),
        isNotNull(thumbnailsTable.appCategory),
      ),
    );
  if (rows.length === 0) return 0;
  const cap = Math.max(1, Math.floor(rows.length * 0.20));
  const byCat = new Map<string, typeof rows>();
  for (const r of rows) {
    const cat = r.appCategory ?? "Other";
    const list = byCat.get(cat) ?? [];
    list.push(r);
    byCat.set(cat, list);
  }
  let archived = 0;
  for (const [cat, list] of byCat.entries()) {
    if (list.length <= cap) continue;
    list.sort((a, b) => a.eloRating - b.eloRating); // lowest first
    const overflow = list.slice(0, list.length - cap);
    for (const row of overflow) {
      await db
        .update(thumbnailsTable)
        .set({ archived: true })
        .where(eq(thumbnailsTable.id, row.id));
      archived += 1;
    }
    logger.info(
      { category: cat, kept: cap, archived: overflow.length },
      "Category balance archive",
    );
  }
  return archived;
}

/**
 * Blok D: chronic-underperformer archive. Run daily.
 * Archives YouTube thumbnails with elo<1100 AND battle_count>=20.
 * (Mid-tier and newcomer thumbnails are protected.)
 */
export async function archiveUnderperformers(): Promise<number> {
  const result = await db
    .update(thumbnailsTable)
    .set({ archived: true })
    .where(
      and(
        eq(thumbnailsTable.archived, false),
        eq(thumbnailsTable.source, "youtube"),
        lt(thumbnailsTable.eloRating, 1100),
        gte(thumbnailsTable.battleCount, 20),
      ),
    )
    .returning({ id: thumbnailsTable.id });
  if (result.length > 0) {
    logger.info({ count: result.length }, "Archived chronic underperformers");
  }
  return result.length;
}

export type { Thumbnail };
