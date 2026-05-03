/**
 * claude/backend-fix-1 follow-up: backfill thumbnail dimensions +
 * is_vertical_thumbnail for existing YouTube rows.
 *
 * Why this exists: when the schema migration added is_vertical_thumbnail,
 * existing rows defaulted to FALSE. The query-time aspect filter
 * (BAD_CONTENT_EXCLUSION_SQL) only kicks in when the column is TRUE — so
 * legacy vertical thumbnails (Hasan Minhaj podcast clips, Tamil
 * motivation Shorts re-uploads, "Part 2 How to make X" cooking shorts)
 * keep showing up.
 *
 * This script fetches each active YouTube row's snippet via the YouTube
 * Data API videos.list endpoint, runs the same vertical-detection logic
 * sync uses, and updates the row. After running, BAD_CONTENT_EXCLUSION_SQL
 * (running on the same is_vertical_thumbnail column) hides the bad rows
 * AND archiveBadContent re-runs to actually mark them archived.
 *
 * Quota: 1 unit per 50 videos via batched videos.list. With ~50 active
 * YouTube rows: 1 quota unit. Trivial.
 *
 * Run: pnpm --filter @workspace/scripts run backfill-thumbnail-dimensions
 */
import { db, thumbnailsTable } from "@workspace/db";
import { sql, isNotNull, eq, and } from "drizzle-orm";

interface YtThumbnail {
  url: string;
  width?: number;
  height?: number;
}

interface YtVideo {
  id: string;
  snippet?: {
    thumbnails?: {
      default?: YtThumbnail;
      medium?: YtThumbnail;
      high?: YtThumbnail;
      standard?: YtThumbnail;
      maxres?: YtThumbnail;
    };
  };
}

interface YtListResponse {
  items?: YtVideo[];
  error?: { code: number; message: string };
}

const YT_BASE = "https://www.googleapis.com/youtube/v3";

function detectVerticalAcrossAllVariants(v: YtVideo): {
  isVertical: boolean;
  width: number | null;
  height: number | null;
} {
  const thumbs = v.snippet?.thumbnails;
  const variants = [
    thumbs?.maxres,
    thumbs?.standard,
    thumbs?.high,
    thumbs?.medium,
    thumbs?.default,
  ].filter((t): t is YtThumbnail => Boolean(t));

  let storedWidth: number | null = null;
  let storedHeight: number | null = null;
  const primary = variants[0];
  if (primary && typeof primary.width === "number" && typeof primary.height === "number") {
    storedWidth = primary.width;
    storedHeight = primary.height;
  }

  // Threshold tightened to ratio <1.5 — keep in sync with the copy in
  // artifacts/api-server/src/lib/youtube.ts. Catches square reuploads
  // and 4:3 / 5:4 podcast clips that the old h≥w check let through.
  let isVertical = false;
  for (const t of variants) {
    if (
      typeof t.width === "number" &&
      typeof t.height === "number" &&
      t.width > 0 &&
      t.height > 0 &&
      t.width / t.height < 1.5
    ) {
      isVertical = true;
      break;
    }
  }
  return { isVertical, width: storedWidth, height: storedHeight };
}

async function fetchVideosByIds(
  apiKey: string,
  ids: string[],
): Promise<YtVideo[]> {
  if (ids.length === 0) return [];
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/videos`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`videos.list failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as YtListResponse;
    if (data.error) {
      throw new Error(`videos.list error: ${data.error.message}`);
    }
    if (data.items) out.push(...data.items);
  }
  return out;
}

async function main() {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    console.error(
      "[backfill-dimensions] YOUTUBE_API_KEY env var required — exiting",
    );
    process.exit(1);
  }

  console.log("[backfill-dimensions] starting backfill");

  // Pull all rows that have a YouTube videoId AND are not archived.
  // We don't filter on `thumbnailWidth IS NULL` because some rows may
  // have width set but is_vertical_thumbnail still wrong from an older
  // sync — re-running the detection costs nothing and fixes drift.
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

  console.log(`[backfill-dimensions] candidates: ${rows.length} active YouTube rows`);
  if (rows.length === 0) {
    console.log("[backfill-dimensions] nothing to do, exiting");
    process.exit(0);
  }

  const ids = rows.map((r) => r.videoId).filter((s): s is string => Boolean(s));
  let videos: YtVideo[];
  try {
    videos = await fetchVideosByIds(apiKey, ids);
  } catch (err) {
    console.error(`[backfill-dimensions] YouTube API call failed:`, err);
    process.exit(1);
  }

  console.log(`[backfill-dimensions] received ${videos.length} video records from API`);

  const byId = new Map<string, YtVideo>();
  for (const v of videos) byId.set(v.id, v);

  let updated = 0;
  let verticalFound = 0;
  let missing = 0;
  for (const row of rows) {
    if (!row.videoId) continue;
    const v = byId.get(row.videoId);
    if (!v) {
      // Video might have been deleted on YouTube — leave row as-is for
      // now (sync will eventually 404 it and we'll handle there).
      missing += 1;
      continue;
    }
    const aspect = detectVerticalAcrossAllVariants(v);
    if (aspect.isVertical) verticalFound += 1;

    await db
      .update(thumbnailsTable)
      .set({
        thumbnailWidth: aspect.width,
        thumbnailHeight: aspect.height,
        isVerticalThumbnail: aspect.isVertical,
      })
      .where(eq(thumbnailsTable.id, row.id));
    updated += 1;
  }

  console.log(
    `[backfill-dimensions] updated ${updated} rows (vertical detected: ${verticalFound}, video missing on YouTube: ${missing})`,
  );

  // Now archive any rows we just flagged as vertical — defense in depth.
  // The query layer will already hide them, but archiving prevents them
  // from cluttering future leaderboards and lets stats stay clean.
  const archiveResult = await db.execute(sql`
    WITH archived AS (
      UPDATE thumbnails
         SET archived = TRUE,
             status = 'bad_content_archived'
       WHERE archived = false
         AND is_vertical_thumbnail = TRUE
       RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM archived
  `);
  const newlyArchived = (archiveResult.rows[0] as { n: number }).n;
  console.log(`[backfill-dimensions] archived ${newlyArchived} newly-flagged vertical rows`);

  // Final state.
  const [post] = (
    await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE archived = false)::int AS active,
        COUNT(*) FILTER (WHERE archived = false AND source = 'youtube')::int AS active_youtube
      FROM thumbnails
    `)
  ).rows as Array<{ active: number; active_youtube: number }>;
  console.log(
    `[backfill-dimensions] final pool: active=${post.active} youtube=${post.active_youtube}`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
