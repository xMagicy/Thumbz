import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const [pre] = (
    await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM thumbnails
      WHERE archived IS NOT TRUE
        AND (
          title ~* '#?(shorts|short|reel)\\b'
          OR title ILIKE '%youtube short%'
          OR (
            published_at IS NOT NULL
            AND view_count IS NOT NULL
            AND view_count / GREATEST(EXTRACT(EPOCH FROM (NOW() - published_at)) / 3600, 1) > 5000
          )
        )
    `)
  ).rows as Array<{ n: number }>;

  console.log(`[archive-shorts] candidates to archive: ${pre.n}`);

  const result = await db.execute(sql`
    WITH updated AS (
      UPDATE thumbnails
         SET archived = TRUE
       WHERE archived IS NOT TRUE
         AND (
           title ~* '#?(shorts|short|reel)\\b'
           OR title ILIKE '%youtube short%'
           OR (
             published_at IS NOT NULL
             AND view_count IS NOT NULL
             AND view_count / GREATEST(EXTRACT(EPOCH FROM (NOW() - published_at)) / 3600, 1) > 5000
           )
         )
       RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM updated
  `);
  const archived = (result.rows[0] as { n: number }).n;
  console.log(`[archive-shorts] archived ${archived} rows`);

  const [verify] = (
    await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM thumbnails
      WHERE archived IS NOT TRUE
        AND (title ~* '#?(shorts|short|reel)\\b' OR title ILIKE '%youtube short%')
    `)
  ).rows as Array<{ n: number }>;

  if (verify.n !== 0) {
    console.error(`[archive-shorts] FAILED: ${verify.n} active rows still match`);
    process.exit(1);
  }
  console.log("[archive-shorts] verified: 0 active rows match Shorts title regex");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
