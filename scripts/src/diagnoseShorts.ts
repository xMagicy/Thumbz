/**
 * Read-only diagnostic for the "Shorts in pool" complaint. Pulls every
 * active YouTube row, asks the YouTube Data API for duration + all
 * thumbnail dimensions + tags + category, and prints the rows that
 * trigger any "looks like a Short" heuristic. The point is to SEE the
 * data so the next filter change is targeted, not guessed.
 *
 * Does NOT modify the database. Output goes to stdout. Quota cost is
 * 1 unit per 50 rows (videos.list batched).
 *
 * Run: pnpm --filter @workspace/scripts run diagnose-shorts
 */
import { db, thumbnailsTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";

interface YtThumbnail {
  url: string;
  width?: number;
  height?: number;
}

interface YtVideo {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    categoryId?: string;
    tags?: string[];
    thumbnails?: {
      default?: YtThumbnail;
      medium?: YtThumbnail;
      high?: YtThumbnail;
      standard?: YtThumbnail;
      maxres?: YtThumbnail;
    };
  };
  contentDetails?: {
    duration?: string;
  };
  statistics?: {
    viewCount?: string;
  };
}

interface YtListResponse {
  items?: YtVideo[];
  error?: { code: number; message: string };
}

const YT_BASE = "https://www.googleapis.com/youtube/v3";

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + min * 60 + s;
}

const SHORTS_TEXT = /#?(shorts|short|ytshorts|youtubeshorts|yshort|reel|reels|tiktok)\b/i;
const SHORTS_TAG = /(short|reel)/i;

async function fetchVideosByIds(
  apiKey: string,
  ids: string[],
): Promise<YtVideo[]> {
  if (ids.length === 0) return [];
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/videos`);
    url.searchParams.set("part", "snippet,contentDetails,statistics");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      throw new Error(`videos.list failed: HTTP ${res.status}\nResponse body: ${body.slice(0, 1500)}`);
    }
    const data = (await res.json()) as YtListResponse;
    if (data.error) throw new Error(`videos.list error: ${data.error.message}`);
    if (data.items) out.push(...data.items);
  }
  return out;
}

function thumbDimsString(v: YtVideo): string {
  const t = v.snippet?.thumbnails;
  if (!t) return "(no thumbs)";
  const parts: string[] = [];
  for (const [name, variant] of [
    ["max", t.maxres],
    ["std", t.standard],
    ["high", t.high],
    ["med", t.medium],
    ["def", t.default],
  ] as const) {
    if (!variant) continue;
    if (typeof variant.width === "number" && typeof variant.height === "number") {
      parts.push(`${name}:${variant.width}x${variant.height}`);
    } else {
      parts.push(`${name}:?x?`);
    }
  }
  return parts.length > 0 ? parts.join(" ") : "(empty thumbs)";
}

function detectReasons(v: YtVideo): string[] {
  const reasons: string[] = [];
  const dur = parseIsoDuration(v.contentDetails?.duration);
  if (dur !== null) {
    if (dur <= 60) reasons.push(`very_short(${dur}s)`);
    else if (dur <= 180) reasons.push(`shorts_duration(${dur}s)`);
    else if (dur <= 240) reasons.push(`borderline_short(${dur}s)`);
  } else {
    reasons.push("no_duration");
  }

  const variants = [
    v.snippet?.thumbnails?.maxres,
    v.snippet?.thumbnails?.standard,
    v.snippet?.thumbnails?.high,
    v.snippet?.thumbnails?.medium,
    v.snippet?.thumbnails?.default,
  ];
  for (const t of variants) {
    if (
      t &&
      typeof t.width === "number" &&
      typeof t.height === "number" &&
      t.width > 0 &&
      t.height >= t.width
    ) {
      reasons.push(`vertical_variant(${t.width}x${t.height})`);
      break;
    }
  }

  if (!v.snippet?.thumbnails?.maxres) reasons.push("no_maxres");

  const title = v.snippet?.title ?? "";
  const desc = v.snippet?.description ?? "";
  if (SHORTS_TEXT.test(title)) reasons.push("shorts_in_title");
  if (SHORTS_TEXT.test(desc)) reasons.push("shorts_in_description");
  if (v.snippet?.tags) {
    for (const tag of v.snippet.tags) {
      if (SHORTS_TAG.test(tag)) {
        reasons.push(`shorts_in_tag(${tag})`);
        break;
      }
    }
  }

  return reasons;
}

async function main() {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    console.error("[diagnose-shorts] YOUTUBE_API_KEY env var required — exiting");
    process.exit(1);
  }

  console.log("[diagnose-shorts] === starting ===");

  const rows = await db
    .select({
      id: thumbnailsTable.id,
      videoId: thumbnailsTable.youtubeVideoId,
      title: thumbnailsTable.title,
    })
    .from(thumbnailsTable)
    .where(
      and(
        eq(thumbnailsTable.archived, false),
        isNotNull(thumbnailsTable.youtubeVideoId),
      ),
    );

  console.log(`[diagnose-shorts] active YouTube rows: ${rows.length}`);
  if (rows.length === 0) {
    console.log("[diagnose-shorts] nothing to diagnose, exiting");
    return;
  }

  const ids = rows.map((r) => r.videoId).filter((s): s is string => Boolean(s));
  let videos: YtVideo[];
  try {
    videos = await fetchVideosByIds(apiKey, ids);
  } catch (err) {
    console.error("[diagnose-shorts] YouTube API call failed:", err);
    process.exit(1);
  }

  console.log(`[diagnose-shorts] received ${videos.length} video records from API`);
  const missing = ids.length - videos.length;
  if (missing > 0) console.log(`[diagnose-shorts] missing on YouTube: ${missing}`);
  console.log("");

  const byId = new Map<string, YtVideo>();
  for (const v of videos) byId.set(v.id, v);

  const reasonCounts = new Map<string, number>();
  let suspect = 0;
  let clean = 0;

  console.log("[diagnose-shorts] === SUSPECT ROWS ===");
  console.log("");

  for (const row of rows) {
    if (!row.videoId) continue;
    const v = byId.get(row.videoId);
    if (!v) {
      console.log(`vid=${row.videoId} title="${(row.title ?? "").slice(0, 80)}" reasons: missing_on_youtube`);
      console.log("");
      suspect++;
      const k = "missing_on_youtube";
      reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
      continue;
    }
    const reasons = detectReasons(v);
    if (reasons.length === 0) {
      clean++;
      continue;
    }
    suspect++;
    for (const r of reasons) {
      const k = r.replace(/\(.+\)/, "");
      reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
    }
    const dur = parseIsoDuration(v.contentDetails?.duration);
    const durStr = dur !== null ? `${dur}s` : "?";
    console.log(`vid=${v.id} dur=${durStr} cat=${v.snippet?.categoryId ?? "?"} thumbs=[${thumbDimsString(v)}]`);
    console.log(`  title:   "${(v.snippet?.title ?? "").slice(0, 100)}"`);
    console.log(`  channel: "${v.snippet?.channelTitle ?? ""}"`);
    console.log(`  reasons: ${reasons.join(", ")}`);
    console.log("");
  }

  console.log("[diagnose-shorts] === SUMMARY ===");
  console.log(`[diagnose-shorts] suspect: ${suspect}, clean: ${clean}, total: ${rows.length}`);
  const sorted = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sorted) {
    console.log(`[diagnose-shorts]   ${reason}: ${count}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[diagnose-shorts] FAILED", err);
    process.exit(1);
  });
