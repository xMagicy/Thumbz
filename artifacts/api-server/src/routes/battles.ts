import { Router } from "express";
import { db, battlesTable, thumbnailsTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";

const router = Router();

// GET /api/battles — battle stats
router.get("/", async (req, res) => {
  try {
    const [{ total }] = await db
      .select({ total: count() })
      .from(battlesTable);

    const recentRows = await db
      .select({
        id: battlesTable.id,
        winnerId: battlesTable.winnerId,
        loserId: battlesTable.loserId,
        createdAt: battlesTable.createdAt,
        winnerTitle: thumbnailsTable.title,
      })
      .from(battlesTable)
      .leftJoin(thumbnailsTable, eq(battlesTable.winnerId, thumbnailsTable.id))
      .orderBy(desc(battlesTable.createdAt))
      .limit(10);

    // We need loser titles too — fetch them separately to keep it simple
    const recentBattles = await Promise.all(
      recentRows.map(async (row) => {
        const [loser] = await db
          .select({ title: thumbnailsTable.title })
          .from(thumbnailsTable)
          .where(eq(thumbnailsTable.id, row.loserId));

        return {
          id: row.id,
          winnerId: row.winnerId,
          loserId: row.loserId,
          winnerTitle: row.winnerTitle ?? "Unknown",
          loserTitle: loser?.title ?? "Unknown",
          createdAt: row.createdAt.toISOString(),
        };
      })
    );

    res.json({
      totalVotes: Number(total),
      recentBattles,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get battle stats");
    res.status(500).json({ error: "Failed to get battle stats" });
  }
});

export default router;
