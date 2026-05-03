import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute(sql`
    WITH updated AS (
      UPDATE thumbnails
         SET archived = TRUE
       WHERE archived IS NOT TRUE
         AND (
           title ~* '\\b(trailer|teaser|first look|sneak peek|coming soon|in theaters|now streaming|premieres|concept trailer)\\b'
           OR title ~* '\\(\\d{4}\\).*\\b(trailer|teaser)\\b'
           OR channel_name ~* '\\b(studios|pictures|films|productions|movieclips|trailers|entertainment group|media group)\\b'
           OR channel_name ILIKE 'Ultimate Studios'
         )
       RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM updated
  `);
  const archived = (result.rows[0] as { n: number }).n;
  console.log(`[archive-trailers] archived ${archived} rows`);

  const [verify] = (
    await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM thumbnails
      WHERE archived IS NOT TRUE
        AND (title ~* '\\b(trailer|teaser)\\b'
             OR channel_name ~* '\\b(studios|pictures|films)\\b')
    `)
  ).rows as Array<{ n: number }>;

  if (verify.n !== 0) {
    console.error(`[archive-trailers] FAILED: ${verify.n} active rows still match`);
    process.exit(1);
  }
  console.log("[archive-trailers] verified: 0 active rows match trailer/studio pattern");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
