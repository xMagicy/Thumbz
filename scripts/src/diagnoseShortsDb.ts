/**
 * DB-only sibling of diagnose-shorts. Same goal — find rows in the
 * active pool that smell like Shorts — but works entirely on persisted
 * columns so no YouTube API call is needed (useful when quota is
 * exhausted).
 *
 * Trade-off: we can't check duration (not persisted) or tags (not
 * persisted). We CAN check: title patterns, channel name patterns,
 * thumbnail dimensions, isVerticalThumbnail, hashtag soup, missing
 * dimensions for legacy rows. That covers most Shorts that leak in.
 *
 * Read-only. Run: pnpm --filter @workspace/scripts run diagnose-shorts-db
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

interface Row {
  id: number;
  videoId: string | null;
  title: string;
  channelName: string;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  isVerticalThumbnail: boolean;
  appCategory: string | null;
  categoryId: number | null;
  viewsPerHour: number | null;
}

const SHORTS_TEXT = /#?(shorts|short|ytshorts|youtubeshorts|yshort|reel|reels|tiktok|minivlog)\b/i;
const HASHTAG_SOUP = /(#[A-Za-z0-9_]+\s*){3,}/;
const CHANNEL_SUFFIX = /\b(Studios|Pictures|Films|Productions|Records|VEVO|Network|Shorts|TikTok|Reels|Entertainment|Cinema|Cinemas|Movies|Trailers|Movieclips)\s*[!.]?\s*$/i;
const CHANNEL_SUBSTR = /\b(Marvel|Disney|Pixar|DreamWorks|Warner Bros|Universal|Paramount|Sony Pictures|Lionsgate|Netflix|HBO|Hulu|CNN|Fox News|MSNBC|BBC News|Cocomelon|Pinkfong|NBA|NFL|FIFA|Coca-Cola|Movieclips|T-Series)\b/i;

function detectReasons(r: Row): string[] {
  const reasons: string[] = [];

  if (SHORTS_TEXT.test(r.title)) reasons.push("shorts_in_title");
  if (HASHTAG_SOUP.test(r.title)) reasons.push("hashtag_soup");
  if (CHANNEL_SUFFIX.test(r.channelName)) reasons.push("channel_suffix");
  if (CHANNEL_SUBSTR.test(r.channelName)) reasons.push("channel_substr");

  if (r.isVerticalThumbnail) reasons.push("is_vertical_flag_TRUE_but_active");

  if (r.thumbnailWidth === null || r.thumbnailHeight === null) {
    reasons.push("dims_NULL_legacy");
  } else {
    if (r.thumbnailHeight >= r.thumbnailWidth) {
      reasons.push(`vertical_dims(${r.thumbnailWidth}x${r.thumbnailHeight})`);
    }
    const ratio = r.thumbnailWidth / r.thumbnailHeight;
    if (ratio < 1.4) {
      reasons.push(`low_ratio(${ratio.toFixed(2)})`);
    }
  }

  return reasons;
}

async function main() {
  console.log("[diagnose-shorts-db] === starting (DB only, no API) ===");

  const result = await db.execute(sql`
    SELECT
      id,
      youtube_video_id     AS "videoId",
      title,
      channel_name         AS "channelName",
      thumbnail_width      AS "thumbnailWidth",
      thumbnail_height     AS "thumbnailHeight",
      is_vertical_thumbnail AS "isVerticalThumbnail",
      app_category         AS "appCategory",
      category_id          AS "categoryId",
      views_per_hour       AS "viewsPerHour"
    FROM thumbnails
    WHERE archived = false
      AND source = 'youtube'
    ORDER BY id
  `);
  const rows = result.rows as unknown as Row[];

  console.log(`[diagnose-shorts-db] active YouTube rows: ${rows.length}`);
  console.log("");

  const reasonCounts = new Map<string, number>();
  let suspect = 0;
  let clean = 0;

  console.log("[diagnose-shorts-db] === SUSPECT ROWS ===");
  console.log("");

  for (const r of rows) {
    const reasons = detectReasons(r);
    if (reasons.length === 0) {
      clean++;
      continue;
    }
    suspect++;
    for (const reason of reasons) {
      const k = reason.replace(/\(.+\)/, "");
      reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
    }
    const dims =
      r.thumbnailWidth !== null && r.thumbnailHeight !== null
        ? `${r.thumbnailWidth}x${r.thumbnailHeight}`
        : "NULL";
    console.log(`vid=${r.videoId ?? "?"} dims=${dims} cat=${r.appCategory ?? "?"} (yt:${r.categoryId ?? "?"}) vph=${r.viewsPerHour?.toFixed(0) ?? "?"}`);
    console.log(`  title:   "${r.title.slice(0, 100)}"`);
    console.log(`  channel: "${r.channelName}"`);
    console.log(`  reasons: ${reasons.join(", ")}`);
    console.log("");
  }

  console.log("[diagnose-shorts-db] === SUMMARY ===");
  console.log(`[diagnose-shorts-db] suspect: ${suspect}, clean: ${clean}, total: ${rows.length}`);
  const sorted = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sorted) {
    console.log(`[diagnose-shorts-db]   ${reason}: ${count}`);
  }

  console.log("");
  console.log("[diagnose-shorts-db] === CATEGORY BREAKDOWN (active pool) ===");
  const catResult = await db.execute(sql`
    SELECT
      COALESCE(app_category, '(null)') AS category,
      COUNT(*)::int                    AS n
    FROM thumbnails
    WHERE archived = false
      AND source = 'youtube'
    GROUP BY app_category
    ORDER BY n DESC
  `);
  for (const row of catResult.rows as Array<{ category: string; n: number }>) {
    console.log(`[diagnose-shorts-db]   ${row.category}: ${row.n}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[diagnose-shorts-db] FAILED", err);
    process.exit(1);
  });
