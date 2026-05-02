import { Router } from "express";
import { db, thumbnailsTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";

const router = Router();

const toDto = (t: typeof thumbnailsTable.$inferSelect) => ({
  id: t.id,
  title: t.title,
  imageUrl: t.imageUrl,
  channelName: t.channelName,
  wins: t.wins,
  losses: t.losses,
  eloRating: t.eloRating,
  winRate:
    t.wins + t.losses > 0
      ? Math.round((t.wins / (t.wins + t.losses)) * 100 * 10) / 10
      : null,
});

// GET /api/thumbnails — list all, sorted by elo desc
router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(thumbnailsTable)
      .orderBy(desc(thumbnailsTable.eloRating));

    res.json(rows.map(toDto));
  } catch (err) {
    req.log.error({ err }, "Failed to list thumbnails");
    res.status(500).json({ error: "Failed to list thumbnails" });
  }
});

// GET /api/thumbnails/battle — two random thumbnails
router.get("/battle", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(thumbnailsTable)
      .orderBy(sql`RANDOM()`)
      .limit(2);

    if (rows.length < 2) {
      return res.status(400).json({ error: "Not enough thumbnails for a battle" });
    }

    res.json({ left: toDto(rows[0]), right: toDto(rows[1]) });
  } catch (err) {
    req.log.error({ err }, "Failed to get battle pair");
    res.status(500).json({ error: "Failed to get battle pair" });
  }
});

export default router;
