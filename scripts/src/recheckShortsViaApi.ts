/**
 * recheck-shorts-via-api
 *
 * Walks every active YouTube-sourced thumbnail in the DB, calls YouTube
 * videos.list (1 quota unit per batch of 50, so ~12 units for the whole
 * pool), and archives any row that:
 *
 *   1. has a duration ≤ 180s            → "shorts_duration"
 *   2. has a vertical/square thumbnail  → "vertical_thumbnail"
 *   3. has a Shorts/Reels marker in
 *      title, description, or tags      → "shorts_text_marker"
 *   4. is no longer retrievable from
 *      YouTube (deleted/private)        → "video_unavailable"
 *
 * For surviving rows we also persist `duration_sec` so the query-time
 * gate (in /api/thumbnails*) can fast-reject Shorts going forward
 * without another API round-trip.
 *
 * Idempotent. Safe to re-run. Run after every schema push or whenever
 * Shorts make it into the active pool by some new failure mode.
 */
import { db, thumbnailsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

const YT_BASE = "https://www.googleapis.com/youtube/v3";

const SHORTS_TEXT_PATTERN =
  /#?(shorts|short|ytshorts|youtubeshorts|yshort|reel|reels|tiktok)\b/i;
// Hashtag-only Shorts markers — `#` is required, otherwise long-form
// titles like "viral marketing explained" or "POV cameras review"
// would false-positive.
const SHORTS_HASHTAG_PATTERN = /#(pov|fyp|foryou|foryoupage)\b/i;
const SHORTS_TAG_PATTERN = /(short|reel)/i;

interface YtThumb {
  url?: string;
  width?: number;
  height?: number;
}
interface YtVideoItem {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    tags?: string[];
    thumbnails?: { maxres?: YtThumb; high?: YtThumb };
  };
  contentDetails?: { duration?: string };
}
interface YtListResponse {
  items?: YtVideoItem[];
  error?: { code: number; message: string };
}

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + s;
}

function pickAspectThumbnail(v: YtVideoItem): YtThumb | null {
  return v.snippet?.thumbnails?.maxres ?? v.snippet?.thumbnails?.high ?? null;
}

type Verdict =
  | { keep: true; durationSec: number | null }
  | { keep: false; reason: string; durationSec: number | null };

function decide(v: YtVideoItem): Verdict {
  const snippet = v.snippet;
  const durationSec = parseIsoDuration(v.contentDetails?.duration);

  if (durationSec !== null && durationSec <= 180) {
    return { keep: false, reason: "shorts_duration", durationSec };
  }

  if (snippet) {
    if (snippet.title && SHORTS_TEXT_PATTERN.test(snippet.title)) {
      return { keep: false, reason: "shorts_title_marker", durationSec };
    }
    if (snippet.title && SHORTS_HASHTAG_PATTERN.test(snippet.title)) {
      return { keep: false, reason: "shorts_title_hashtag", durationSec };
    }
    if (
      snippet.description &&
      (SHORTS_TEXT_PATTERN.test(snippet.description) ||
        SHORTS_HASHTAG_PATTERN.test(snippet.description))
    ) {
      return { keep: false, reason: "shorts_description_marker", durationSec };
    }
    if (snippet.tags && snippet.tags.length > 0) {
      for (const tag of snippet.tags) {
        if (SHORTS_TAG_PATTERN.test(tag)) {
          return { keep: false, reason: "shorts_tag", durationSec };
        }
      }
    }
  }

  // Aspect ratio: maxres is reliable, high is letterboxed 4:3 for many
  // genuinely-landscape uploads — so we ONLY trust this signal when
  // looking at maxres. Falling back to `high` would false-positive on
  // every video that lacks maxres (see the 918197a → 773e0f2 revert
  // history for context).
  const maxres = v.snippet?.thumbnails?.maxres;
  if (
    maxres &&
    typeof maxres.width === "number" &&
    typeof maxres.height === "number" &&
    maxres.width > 0 &&
    maxres.height >= maxres.width
  ) {
    return { keep: false, reason: "vertical_thumbnail", durationSec };
  }

  return { keep: true, durationSec };
}

async function fetchVideoBatch(
  apiKey: string,
  ids: string[],
): Promise<Map<string, YtVideoItem>> {
  const url = new URL(`${YT_BASE}/videos`);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", apiKey);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`videos.list ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as YtListResponse;
  if (data.error) {
    throw new Error(`videos.list error ${data.error.code}: ${data.error.message}`);
  }
  const out = new Map<string, YtVideoItem>();
  for (const item of data.items ?? []) {
    if (item.id) out.set(item.id, item);
  }
  return out;
}

async function main() {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    console.error("[recheck-shorts] YOUTUBE_API_KEY is not set");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: thumbnailsTable.id,
      videoId: thumbnailsTable.youtubeVideoId,
    })
    .from(thumbnailsTable)
    .where(
      and(
        eq(thumbnailsTable.archived, false),
        eq(thumbnailsTable.status, "active"),
        eq(thumbnailsTable.source, "youtube"),
        isNotNull(thumbnailsTable.youtubeVideoId),
      ),
    );

  console.log(`[recheck-shorts] active youtube rows to check: ${rows.length}`);
  if (rows.length === 0) {
    process.exit(0);
  }

  const byVideoId = new Map<string, number>();
  for (const r of rows) {
    if (r.videoId) byVideoId.set(r.videoId, r.id);
  }

  const allVideoIds = Array.from(byVideoId.keys());
  const archives = new Map<string, number[]>(); // reason -> rowIds
  const durationUpdates: Array<{ id: number; durationSec: number }> = [];
  const missingFromApi: number[] = [];
  let kept = 0;

  for (let i = 0; i < allVideoIds.length; i += 50) {
    const batch = allVideoIds.slice(i, i + 50);
    const fetched = await fetchVideoBatch(apiKey, batch);

    for (const videoId of batch) {
      const rowId = byVideoId.get(videoId)!;
      const item = fetched.get(videoId);
      if (!item) {
        missingFromApi.push(rowId);
        continue;
      }
      const verdict = decide(item);
      if (verdict.durationSec !== null) {
        durationUpdates.push({ id: rowId, durationSec: verdict.durationSec });
      }
      if (verdict.keep) {
        kept += 1;
      } else {
        const list = archives.get(verdict.reason) ?? [];
        list.push(rowId);
        archives.set(verdict.reason, list);
      }
    }
    console.log(
      `[recheck-shorts] batch ${i / 50 + 1}/${Math.ceil(
        allVideoIds.length / 50,
      )} done`,
    );
  }

  // Persist duration_sec for everyone we got data for. Cheap, idempotent.
  for (const u of durationUpdates) {
    await db
      .update(thumbnailsTable)
      .set({ durationSec: u.durationSec })
      .where(eq(thumbnailsTable.id, u.id));
  }
  console.log(
    `[recheck-shorts] populated duration_sec on ${durationUpdates.length} rows`,
  );

  // Archive rows that failed any check.
  const allArchiveIds: number[] = [];
  for (const [reason, ids] of archives.entries()) {
    if (ids.length === 0) continue;
    await db
      .update(thumbnailsTable)
      .set({ archived: true })
      .where(inArray(thumbnailsTable.id, ids));
    allArchiveIds.push(...ids);
    console.log(`[recheck-shorts]   archived ${ids.length} as ${reason}`);
  }

  // Rows YouTube no longer returns (deleted, private, region-locked):
  // archive them too so they stop showing up in battles.
  if (missingFromApi.length > 0) {
    await db
      .update(thumbnailsTable)
      .set({ archived: true })
      .where(inArray(thumbnailsTable.id, missingFromApi));
    console.log(
      `[recheck-shorts]   archived ${missingFromApi.length} as video_unavailable`,
    );
  }

  // Sanity verification: no row with duration_sec ≤ 180 should still
  // be active. If there is, the script has a bug — fail loudly so
  // it gets caught in the next run.
  const [stillActive] = (
    await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM thumbnails
      WHERE archived = FALSE
        AND status = 'active'
        AND duration_sec IS NOT NULL
        AND duration_sec <= 180
    `)
  ).rows as Array<{ n: number }>;
  if (stillActive.n !== 0) {
    console.error(
      `[recheck-shorts] FAILED: ${stillActive.n} active rows still have duration_sec <= 180`,
    );
    process.exit(1);
  }

  console.log(
    `[recheck-shorts] done. kept=${kept}, archived=${
      allArchiveIds.length + missingFromApi.length
    }, missing=${missingFromApi.length}, batches=${Math.ceil(
      allVideoIds.length / 50,
    )}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
