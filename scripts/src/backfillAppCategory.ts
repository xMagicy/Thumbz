import { db, thumbnailsTable } from "@workspace/db";
import { sql, isNull } from "drizzle-orm";

async function main() {
  const [{ before }] = (await db.execute(
    sql`SELECT COUNT(*)::int AS before FROM thumbnails WHERE app_category IS NULL`,
  )).rows as Array<{ before: number }>;

  console.log(`[backfill] rows with NULL app_category before: ${before}`);

  const updated = await db
    .update(thumbnailsTable)
    .set({ appCategory: sql`${thumbnailsTable.niche}` })
    .where(isNull(thumbnailsTable.appCategory))
    .returning({ id: thumbnailsTable.id });

  console.log(`[backfill] updated ${updated.length} rows`);

  const [{ after }] = (await db.execute(
    sql`SELECT COUNT(*)::int AS after FROM thumbnails WHERE app_category IS NULL`,
  )).rows as Array<{ after: number }>;

  if (after !== 0) {
    console.error(
      `[backfill] FAILED: ${after} rows still have NULL app_category`,
    );
    process.exit(1);
  }

  console.log("[backfill] verified: 0 rows with NULL app_category remain");
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] error", err);
  process.exit(1);
});
