/**
 * claude/backend-fix-1: comprehensive cleanup of bad content.
 *
 * One-shot, idempotent cleanup for legacy thumbnails that pre-date the
 * current filter chain. Combines and supersedes archiveShorts +
 * archiveTrailers — run THIS script after deploying claude/backend-fix-1
 * and the filters in BAD_CONTENT_EXCLUSION_SQL (routes/thumbnails.ts)
 * will keep the pool clean from new bad content going forward.
 *
 * What it archives (status='bad_content_archived', archived=true):
 *   1. Shorts hashtag markers in title (#shorts, #ytshorts, #reel, etc.)
 *   2. Trailer keywords in title (trailer, teaser, release, etc.)
 *   3. Year-in-parens trailer patterns ("Movie (2026) Trailer")
 *   4. Pipe-separated cast lists (Tollywood/Bollywood movie sig)
 *   5. Channel name SUFFIX matches (Studios, Pictures, Films,
 *      Entertainment, Cinema, Cinemas, Movies, Trailers, Movieclips,
 *      Shorts, TikTok, Reels, Productions, Records, VEVO, Network)
 *   6. Channel name SUBSTRING matches (movie studios, music labels,
 *      news networks, kids factories, sports leagues, brand channels)
 *   7. Vertical thumbnails where width/height are persisted
 *
 * The script prints a per-rule breakdown plus an end-state verification
 * query so a single run shows: how much was already clean, how much we
 * archived, and confirmation that ZERO active rows remain matching any
 * rule. Run via: pnpm --filter @workspace/scripts run cleanup-bad-content
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

interface Counts {
  rule: string;
  archived: number;
}

async function archiveByRule(
  rule: string,
  predicateSql: ReturnType<typeof sql>,
): Promise<number> {
  const result = await db.execute(sql`
    WITH updated AS (
      UPDATE thumbnails
         SET archived = TRUE,
             status = 'bad_content_archived'
       WHERE archived IS NOT TRUE
         AND ${predicateSql}
       RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM updated
  `);
  const n = (result.rows[0] as { n: number }).n;
  console.log(`[cleanup-bad-content] ${rule}: archived ${n}`);
  return n;
}

async function main() {
  console.log("[cleanup-bad-content] starting comprehensive cleanup");

  // Pre-cleanup snapshot — gives a "before" picture for the report.
  const [pre] = (
    await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE archived = false)::int AS active
      FROM thumbnails
    `)
  ).rows as Array<{ total: number; active: number }>;
  console.log(
    `[cleanup-bad-content] before: total=${pre.total} active=${pre.active}`,
  );

  const counts: Counts[] = [];

  // 1. Shorts hashtag markers.
  counts.push({
    rule: "shorts_hashtag",
    archived: await archiveByRule(
      "shorts_hashtag",
      sql`(title ~* '#?(shorts|short|ytshorts|youtubeshorts|reels?|tiktoks?|minivlog)\\M' OR title ILIKE '%youtube short%')`,
    ),
  });

  // 2. Trailer keywords (mirrors TRAILER_TITLE_PATTERN in sync layer).
  counts.push({
    rule: "trailer_keywords",
    archived: await archiveByRule(
      "trailer_keywords",
      sql`title ~* '\\m(trailer|teaser|first look|sneak peek|coming soon|in theaters|in cinemas|now streaming|premieres?|world premiere|official trailer|concept trailer|fan trailer|main trailer|release trailer|final trailer|new trailer|behind the scenes|now playing)\\M'`,
    ),
  });

  // 3. Year-in-parens trailer patterns.
  counts.push({
    rule: "trailer_year_pattern",
    archived: await archiveByRule(
      "trailer_year_pattern",
      sql`(title ~* '\\(\\d{4}\\).*(trailer|teaser|first look|release)' OR title ~* '(trailer|teaser|first look|release).*\\(\\d{4}\\)')`,
    ),
  });

  // 4. Pipe cast list — Tollywood/Bollywood signature.
  counts.push({
    rule: "trailer_pipe_cast_list",
    archived: await archiveByRule(
      "trailer_pipe_cast_list",
      sql`title ~ '(\\s\\|\\s[^|]{2,30}){3,}'`,
    ),
  });

  // 5. Channel name suffix blocklist.
  counts.push({
    rule: "channel_suffix_blocklist",
    archived: await archiveByRule(
      "channel_suffix_blocklist",
      sql`channel_name ~* '\\m(Studios|Pictures|Films|Productions|Records|VEVO|Network|Shorts|TikTok|Reels|Entertainment|Cinema|Cinemas|Movies|Trailers|Movieclips)\\s*[!.]?\\s*$'`,
    ),
  });

  // 6. Channel name substring blocklist (specific brands/aggregators).
  counts.push({
    rule: "channel_substring_blocklist",
    archived: await archiveByRule(
      "channel_substring_blocklist",
      sql`channel_name ~* '\\m(Marvel|Disney|Pixar|DreamWorks|Warner Bros|Universal|Paramount|Sony Pictures|Lionsgate|Netflix|HBO|Hulu|Disney\\+|CNN|Fox News|MSNBC|BBC News|Cocomelon|Pinkfong|NBA|NFL|FIFA|Coca-Cola|Movieclips|Entertainment Group|Media Group|Music Group|Animation|Trailers|T-Series|Yash Raj Films|Eros Now|Aditya Music|Clap Entertainment|Hombale Films|Pen Studios|Lahari Music)\\M'`,
    ),
  });

  // 7. Vertical thumbnails (the persisted flag — only matches rows where
  // sync wrote thumbnail_width/height already; legacy rows pass through
  // here because is_vertical_thumbnail defaults false. Run
  // backfill-thumbnail-dimensions FIRST to populate the column on
  // legacy rows, then this rule will catch them).
  counts.push({
    rule: "vertical_thumbnail",
    archived: await archiveByRule(
      "vertical_thumbnail",
      sql`is_vertical_thumbnail = TRUE`,
    ),
  });

  // 7b. Hashtag soup detector. Three-or-more hashtags in a title is a
  // near-universal Shorts/TikTok cross-post signature. Tamil motivation
  // ("Money is Important 💯 #ajayrajendran #facts #lifelessons #…"),
  // beauty/fitness re-uploads, viral meme accounts — all share this
  // shape. Catches the entire pattern in one rule.
  counts.push({
    rule: "hashtag_soup",
    archived: await archiveByRule(
      "hashtag_soup",
      sql`title ~ '(#[A-Za-z0-9_]+\\s*){3,}'`,
    ),
  });

  // 8. Mark Music app_category rows as archived too (Music removal per
  // user spec). Existing rows wouldn't have been re-classified after
  // the Music removal, so this catches the lingering Music thumbnails.
  counts.push({
    rule: "music_category",
    archived: await archiveByRule(
      "music_category",
      sql`(app_category = 'Music' OR niche = 'Music')`,
    ),
  });

  const totalArchived = counts.reduce((s, c) => s + c.archived, 0);
  console.log(
    `[cleanup-bad-content] total archived this run: ${totalArchived}`,
  );

  // Verification — run the same predicates as runtime BAD_CONTENT_EXCLUSION_SQL.
  // Should be 0 across the board after the script.
  const [verify] = (
    await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM thumbnails
      WHERE archived = false
        AND status = 'active'
        AND (
          title ~* '#?(shorts|short|ytshorts|youtubeshorts|reels?|tiktoks?|minivlog)\\M'
          OR title ~* '\\m(trailer|teaser|first look|sneak peek|coming soon|in theaters|in cinemas|now streaming|premieres?|world premiere|official trailer|concept trailer|fan trailer|main trailer|release trailer|final trailer|new trailer|behind the scenes|now playing)\\M'
          OR title ~* '\\(\\d{4}\\).*(trailer|teaser|first look|release)'
          OR title ~* '(trailer|teaser|first look|release).*\\(\\d{4}\\)'
          OR title ~ '(\\s\\|\\s[^|]{2,30}){3,}'
          OR title ~ '(#[A-Za-z0-9_]+\\s*){3,}'
          OR channel_name ~* '\\m(Studios|Pictures|Films|Productions|Records|VEVO|Network|Shorts|TikTok|Reels|Entertainment|Cinema|Cinemas|Movies|Trailers|Movieclips)\\s*[!.]?\\s*$'
          OR is_vertical_thumbnail = TRUE
        )
    `)
  ).rows as Array<{ n: number }>;
  if (verify.n !== 0) {
    console.error(
      `[cleanup-bad-content] FAILED: ${verify.n} active rows still match a rule`,
    );
    process.exit(1);
  }
  console.log(
    `[cleanup-bad-content] verified: 0 active rows match any bad-content rule`,
  );

  // Post-cleanup snapshot.
  const [post] = (
    await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE archived = false)::int AS active,
        COUNT(*) FILTER (WHERE archived = false AND source = 'youtube')::int AS active_youtube,
        COUNT(*) FILTER (WHERE archived = false AND source = 'user')::int AS active_user
      FROM thumbnails
    `)
  ).rows as Array<{
    total: number;
    active: number;
    active_youtube: number;
    active_user: number;
  }>;
  console.log(
    `[cleanup-bad-content] after: total=${post.total} active=${post.active} (youtube=${post.active_youtube}, user=${post.active_user})`,
  );

  // Per-category breakdown so the operator can see whether the pool is
  // diverse enough — feeds directly into the user's "more Tech, less
  // Gaming" feedback loop.
  const cats = (
    await db.execute(sql`
      SELECT app_category AS category, COUNT(*)::int AS n
      FROM thumbnails
      WHERE archived = false AND source = 'youtube' AND app_category IS NOT NULL
      GROUP BY app_category
      ORDER BY 2 DESC
    `)
  ).rows as Array<{ category: string; n: number }>;
  console.log("[cleanup-bad-content] active YouTube pool by category:");
  for (const c of cats) {
    console.log(`  ${c.category}: ${c.n}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
