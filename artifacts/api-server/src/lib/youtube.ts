import {
  db,
  thumbnailsTable,
  viewSnapshotsTable,
  type Thumbnail,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * YouTube Data API v3 — Trending sync.
 *
 * Pulls `videos.list?chart=mostPopular` per region, upserts each video
 * into `thumbnails` keyed by `youtubeVideoId`, and snapshots the view
 * count into `view_snapshots` so we can compute views-per-hour velocity.
 *
 * Quota: each list call = 1 unit. Daily free quota = 10,000 units.
 * We pull 2 regions × 4 syncs/day = 8 calls/day. Well under budget.
 *
 * No fake data — if YOUTUBE_API_KEY is missing, sync is a no-op and
 * logs a clear warning. Charts/leaderboards keep working with real
 * user-uploaded data only.
 */

const YT_BASE = "https://www.googleapis.com/youtube/v3";

// YouTube video category IDs → our internal niche enum.
// Reference: https://developers.google.com/youtube/v3/docs/videoCategories/list
// (Categories not listed below fall through to "Other".)
const CATEGORY_TO_NICHE: Record<string, string> = {
  "1": "Lifestyle", // Film & Animation
  "2": "Other", // Autos & Vehicles
  "10": "Music", // Music
  "15": "Lifestyle", // Pets & Animals
  "17": "Other", // Sports
  "19": "Lifestyle", // Travel & Events
  "20": "Gaming", // Gaming
  "22": "Vlog", // People & Blogs
  "23": "Lifestyle", // Comedy
  "24": "Lifestyle", // Entertainment
  "25": "Other", // News & Politics
  "26": "Tutorial", // Howto & Style
  "27": "Tutorial", // Education
  "28": "Tech", // Science & Technology
};

function mapCategoryToNiche(categoryId: string | undefined): string {
  if (!categoryId) return "Other";
  return CATEGORY_TO_NICHE[categoryId] ?? "Other";
}

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

/**
 * Quality thumbnail picker — only maxres (1280×720) or high (480×360).
 * Returns null if neither is present, signalling that the caller should
 * skip this video (default 120×90 thumbs are usually low-effort uploads).
 */
function pickQualityThumbnail(v: YtVideo): string | null {
  const t = v.snippet?.thumbnails;
  if (!t) return null;
  return t.maxres?.url ?? t.high?.url ?? null;
}

/**
 * Parse ISO 8601 duration (PT#H#M#S) into seconds.
 * Examples: "PT45S" → 45, "PT2M30S" → 150, "PT1H5M" → 3900.
 * Returns null on invalid input.
 */
function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + s;
}

/**
 * Quality gate. Returns null if the video passes, or a string reason
 * for logging/debugging if it should be skipped.
 *
 * Filters (all must pass):
 *  - Category != 10 (Music) — lyric videos & auto-generated thumbs
 *  - Published within last 14 days
 *  - Duration ≥ 60s (excludes most Shorts)
 *  - viewCount ≥ 100k AND happened within 7d of publish (proven viral)
 *  - likes/views ≥ 2% (strong engagement signal)
 *  - Has maxres or high-res thumbnail (handled by caller)
 */
const NOW_TS = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function qualityCheck(v: YtVideo): string | null {
  const snippet = v.snippet;
  const stats = v.statistics;
  if (!snippet || !stats) return "missing_metadata";

  if (snippet.categoryId === "10") return "music_excluded";

  const publishedAt = new Date(snippet.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return "bad_publish_date";

  const ageMs = NOW_TS() - publishedAt;
  if (ageMs > 14 * DAY_MS) return "too_old";
  if (ageMs < 0) return "future_publish_date";

  const durationSec = parseIsoDuration(v.contentDetails?.duration);
  if (durationSec === null) return "no_duration";
  if (durationSec < 60) return "short_form";

  const views = Number(stats.viewCount);
  const likes = Number(stats.likeCount);
  if (!Number.isFinite(views) || views <= 0) return "no_views";

  // 100k views, prorated against the 7-day window.
  // If the video is 3 days old we require ≥ 100k * (3/7) ≈ 43k.
  // Older than 7 days uses the full 100k threshold.
  const ageDays = ageMs / DAY_MS;
  const windowDays = Math.min(7, Math.max(0.5, ageDays));
  const minViewsForAge = (100_000 * windowDays) / 7;
  if (views < minViewsForAge) return "below_view_velocity";

  if (!Number.isFinite(likes)) return "no_like_count";
  const engagement = likes / views;
  if (engagement < 0.02) return "low_engagement";

  return null;
}

interface SyncResult {
  region: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Sync trending videos for a single region.
 *
 * Upsert rules:
 *  - New video (no row with this youtubeVideoId) → INSERT with
 *    source="youtube", elo=1000, wins=losses=0.
 *  - Existing video → UPDATE viewCount/velocity/publishedAt/lastSyncedAt
 *    only. We deliberately do NOT touch elo/wins/losses — those belong
 *    to the voting system.
 *  - Always append a row to view_snapshots so we can chart velocity
 *    over time later.
 */
async function syncRegion(
  apiKey: string,
  regionCode: string,
  maxResults: number,
): Promise<SyncResult> {
  const result: SyncResult = {
    region: regionCode,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  const url = new URL(`${YT_BASE}/videos`);
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", regionCode);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `YouTube API ${res.status} for region=${regionCode}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as YtListResponse;
  if (data.error) {
    throw new Error(
      `YouTube API error ${data.error.code}: ${data.error.message}`,
    );
  }
  const items = data.items ?? [];
  result.fetched = items.length;

  const now = new Date();

  for (const v of items) {
    try {
      const videoId = v.id;
      const snippet = v.snippet;
      const stats = v.statistics;
      const imageUrl = pickQualityThumbnail(v);
      const viewCountStr = stats?.viewCount;

      if (!videoId || !snippet || !viewCountStr) {
        result.skipped += 1;
        continue;
      }
      if (!imageUrl) {
        result.skipped += 1;
        continue;
      }

      const viewCount = Number(viewCountStr);
      if (!Number.isFinite(viewCount)) {
        result.skipped += 1;
        continue;
      }

      const failReason = qualityCheck(v);
      if (failReason) {
        result.skipped += 1;
        continue;
      }

      const publishedAt = new Date(snippet.publishedAt);
      const niche = mapCategoryToNiche(snippet.categoryId);
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

      // Look up existing row + most recent snapshot in one go.
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
        // Find latest snapshot for velocity calc.
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
        const [inserted] = await db
          .insert(thumbnailsTable)
          .values({
            title: snippet.title,
            imageUrl,
            channelName: snippet.channelTitle,
            niche,
            youtubeUrl,
            status: "active",
            source: "youtube",
            youtubeVideoId: videoId,
            viewCount,
            publishedAt,
            lastSyncedAt: now,
          })
          .returning({ id: thumbnailsTable.id });
        if (!inserted) {
          result.errors += 1;
          continue;
        }
        thumbnailId = inserted.id;
        result.inserted += 1;
      }

      // Compute velocity (views/hour) if we have a previous snapshot.
      // Negative deltas (rare — usually a YouTube count correction) are
      // stored as 0 to avoid polluting the "rising" sort.
      let viewVelocity: number | null = null;
      if (prevViewCount !== null && prevCapturedAt) {
        const hours =
          (now.getTime() - prevCapturedAt.getTime()) / (1000 * 60 * 60);
        if (hours > 0) {
          const delta = viewCount - prevViewCount;
          viewVelocity = Math.max(0, delta / hours);
        }
      }

      if (existing) {
        await db
          .update(thumbnailsTable)
          .set({
            // Refresh metadata in case the channel renamed/retitled.
            title: snippet.title,
            channelName: snippet.channelTitle,
            niche,
            imageUrl,
            youtubeUrl,
            viewCount,
            viewVelocity,
            publishedAt,
            lastSyncedAt: now,
          })
          .where(eq(thumbnailsTable.id, thumbnailId));
        result.updated += 1;
      }

      // Always append a snapshot for future velocity calculations.
      await db.insert(viewSnapshotsTable).values({
        thumbnailId,
        viewCount,
        capturedAt: now,
      });
    } catch (err) {
      result.errors += 1;
      logger.error({ err, videoId: v.id }, "Failed to sync YouTube video");
    }
  }

  return result;
}

export async function syncTrendingVideos(opts?: {
  regions?: string[];
  maxResults?: number;
}): Promise<{ ok: boolean; results: SyncResult[]; reason?: string }> {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    logger.warn(
      "YOUTUBE_API_KEY not set — skipping trending sync. Real user data continues unaffected.",
    );
    return { ok: false, results: [], reason: "missing_api_key" };
  }

  const regions = opts?.regions ?? ["NL", "US"];
  const maxResults = Math.min(50, Math.max(1, opts?.maxResults ?? 25));

  const results: SyncResult[] = [];
  for (const region of regions) {
    try {
      const r = await syncRegion(apiKey, region, maxResults);
      results.push(r);
      logger.info({ ...r }, "YouTube trending sync completed");
    } catch (err) {
      logger.error({ err, region }, "YouTube trending sync failed for region");
      results.push({
        region,
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 1,
      });
    }
  }
  return { ok: true, results };
}

// Re-exported for tests / admin route inspection.
export type { Thumbnail };
