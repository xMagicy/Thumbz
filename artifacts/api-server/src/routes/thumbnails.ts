import { Router } from "express";
import { db, thumbnailsTable, battlesTable } from "@workspace/db";
import { eq, sql, ne, desc, count } from "drizzle-orm";
import { CastVoteBody } from "@workspace/api-zod";

const router = Router();

// GET /api/thumbnails — list all, sorted by elo desc
router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(thumbnailsTable)
      .orderBy(desc(thumbnailsTable.eloRating));

    const thumbnails = rows.map((t) => ({
      id: t.id,
      title: t.title,
      imageUrl: t.imageUrl,
      channelName: t.channelName,
      wins: t.wins,
      losses: t.losses,
      eloRating: t.eloRating,
      winRate: t.wins + t.losses > 0
        ? Math.round((t.wins / (t.wins + t.losses)) * 100 * 10) / 10
        : null,
    }));

    res.json(thumbnails);
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

    const toDto = (t: typeof rows[0]) => ({
      id: t.id,
      title: t.title,
      imageUrl: t.imageUrl,
      channelName: t.channelName,
      wins: t.wins,
      losses: t.losses,
      eloRating: t.eloRating,
      winRate: t.wins + t.losses > 0
        ? Math.round((t.wins / (t.wins + t.losses)) * 100 * 10) / 10
        : null,
    });

    res.json({ left: toDto(rows[0]), right: toDto(rows[1]) });
  } catch (err) {
    req.log.error({ err }, "Failed to get battle pair");
    res.status(500).json({ error: "Failed to get battle pair" });
  }
});

// POST /api/battles/vote — cast a vote
router.post("/vote", async (req, res) => {
  const parsed = CastVoteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { winnerId, loserId } = parsed.data;

  if (winnerId === loserId) {
    return res.status(400).json({ error: "Winner and loser must be different" });
  }

  try {
    // Fetch both thumbnails
    const [winner] = await db
      .select()
      .from(thumbnailsTable)
      .where(eq(thumbnailsTable.id, winnerId));

    const [loser] = await db
      .select()
      .from(thumbnailsTable)
      .where(eq(thumbnailsTable.id, loserId));

    if (!winner) return res.status(404).json({ error: `Thumbnail ${winnerId} not found` });
    if (!loser) return res.status(404).json({ error: `Thumbnail ${loserId} not found` });

    // ELO calculation (K=32)
    const K = 32;
    const expectedWin = 1 / (1 + Math.pow(10, (loser.eloRating - winner.eloRating) / 400));
    const expectedLoss = 1 - expectedWin;
    const newWinnerElo = Math.round(winner.eloRating + K * (1 - expectedWin));
    const newLoserElo = Math.round(loser.eloRating + K * (0 - expectedLoss));

    // Update winner
    const [updatedWinner] = await db
      .update(thumbnailsTable)
      .set({
        wins: winner.wins + 1,
        eloRating: newWinnerElo,
      })
      .where(eq(thumbnailsTable.id, winnerId))
      .returning();

    // Update loser
    const [updatedLoser] = await db
      .update(thumbnailsTable)
      .set({
        losses: loser.losses + 1,
        eloRating: newLoserElo,
      })
      .where(eq(thumbnailsTable.id, loserId))
      .returning();

    // Record battle
    await db.insert(battlesTable).values({ winnerId, loserId });

    // Count total votes
    const [{ total }] = await db
      .select({ total: count() })
      .from(battlesTable);

    const toDto = (t: typeof updatedWinner) => ({
      id: t.id,
      title: t.title,
      imageUrl: t.imageUrl,
      channelName: t.channelName,
      wins: t.wins,
      losses: t.losses,
      eloRating: t.eloRating,
      winRate: t.wins + t.losses > 0
        ? Math.round((t.wins / (t.wins + t.losses)) * 100 * 10) / 10
        : null,
    });

    res.json({
      winner: toDto(updatedWinner),
      loser: toDto(updatedLoser),
      totalVotes: Number(total),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to cast vote");
    res.status(500).json({ error: "Failed to cast vote" });
  }
});

export default router;
