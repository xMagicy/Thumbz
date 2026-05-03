/**
 * One-shot recovery script for the broken backfill incident at commit
 * 918197a. That commit tightened the aspect-ratio threshold from h≥w
 * to ratio <1.5, which incorrectly flagged every active YouTube row as
 * vertical (because YouTube always returns 4:3-letterboxed default /
 * high / standard variants for every video, including pure landscape
 * uploads). The follow-up backfill run archived all 175 active rows.
 *
 * Recovery sequence (idempotent — safe to re-run):
 *   1. (out of scope) Sync claude/backend-fix-1 at the revert commit
 *   2. (out of scope) Re-run backfill-thumbnail-dimensions — repopulates
 *      is_vertical_thumbnail with the corrected h≥w check, flipping the
 *      wrongly-flagged 175 rows back to FALSE.
 *   3. THIS SCRIPT: un-archive bad_content_archived rows where
 *      is_vertical_thumbnail is now FALSE — those are exactly the rows
 *      that were only ever archived because of the broken threshold.
 *      Rows archived for OTHER reasons (trailers, hashtag soup, channel
 *      blocklist) keep is_vertical_thumbnail = FALSE too, so they would
 *      get wrongly restored here — that is fine because step 4
 *      re-archives them.
 *   4. (out of scope) Re-run cleanup-bad-content — re-archives anything
 *      that legitimately matches a non-vertical rule. Idempotent.
 *
 * Run: pnpm --filter @workspace/scripts run restore-broken-backfill
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[restore-broken-backfill] starting recovery");

  const [pre] = (
    await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE archived = false)::int AS active,
        COUNT(*) FILTER (
          WHERE archived = true
            AND status = 'bad_content_archived'
            AND source = 'youtube'
            AND is_vertical_thumbnail = false
        )::int AS recoverable
      FROM thumbnails
    `)
  ).rows as Array<{ total: number; active: number; recoverable: number }>;

  console.log(
    `[restore-broken-backfill] before: total=${pre.total} active=${pre.active} recoverable=${pre.recoverable}`,
  );

  if (pre.recoverable === 0) {
    console.log("[restore-broken-backfill] nothing to recover — exiting");
    return;
  }

  const result = await db.execute(sql`
    WITH updated AS (
      UPDATE thumbnails
         SET archived = false,
             status = 'active'
       WHERE archived = true
         AND status = 'bad_content_archived'
         AND source = 'youtube'
         AND is_vertical_thumbnail = false
       RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM updated
  `);
  const n = (result.rows[0] as { n: number }).n;
  console.log(`[restore-broken-backfill] restored ${n} rows`);

  const [post] = (
    await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE archived = false)::int AS active
      FROM thumbnails
    `)
  ).rows as Array<{ total: number; active: number }>;
  console.log(
    `[restore-broken-backfill] after: total=${post.total} active=${post.active}`,
  );
  console.log(
    "[restore-broken-backfill] NOW run cleanup-bad-content to re-archive rows that match other rules",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[restore-broken-backfill] FAILED", err);
    process.exit(1);
  });
