import { Router } from "express";
import { db, battlesTable, thumbnailsTable, ratingHistoryTable } from "@workspace/db";
import { eq, count, desc, inArray } from "drizzle-orm";
import { CastVoteBody } from "@workspace/api-zod";
import { voteRateLimiter, clientKey } from "../lib/rateLimits";
import { recordVoteOrReject } from "../lib/voteDedup";

const router = Router();

const toDto = (t: typeof thumbnailsTable.$inferSelect) => ({
  id: t.id,
  title: t.title,
  imageUrl: t.imageUrl,
  channelName: t.channelName,
  channelId: t.channelId,
  channelLogoUrl: t.channelLogoUrl,
  wins: t.wins,
  losses: t.losses,
  eloRating: t.eloRating,
  winRate:
    t.wins + t.losses > 0
      ? Math.round((t.wins / (t.wins + t.losses)) * 100 * 10) / 10
      : null,
});

// GET /api/battles — battle stats
router.get("/", async (req, res) => {
  try {
    const [{ total }] = await db.select({ total: count() }).from(battlesTable);

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

    // Fetch all loser titles in a single IN(...) query and build a lookup map.
    // The previous version did one query per battle (N+1), which inflated this
    // endpoint to ~11 queries for the standard 10-row response.
    const loserIds = Array.from(new Set(recentRows.map((r) => r.loserId)));
    const loserTitleById = new Map<number, string>();
    if (loserIds.length > 0) {
      const loserRows = await db
        .select({ id: thumbnailsTable.id, title: thumbnailsTable.title })
        .from(thumbnailsTable)
        .where(inArray(thumbnailsTable.id, loserIds));
      for (const row of loserRows) {
        loserTitleById.set(row.id, row.title);
      }
    }

    const recentBattles = recentRows.map((row) => ({
      id: row.id,
      winnerId: row.winnerId,
      loserId: row.loserId,
      winnerTitle: row.winnerTitle ?? "Unknown",
      loserTitle: loserTitleById.get(row.loserId) ?? "Unknown",
      createdAt: row.createdAt.toISOString(),
    }));

    res.json({
      totalVotes: Number(total),
      recentBattles,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get battle stats");
    res.status(500).json({ error: "Failed to get battle stats" });
  }
});

// POST /api/battles/vote — cast a vote.
//
// Two layers of abuse protection (Blok H P1):
//   1. voteRateLimiter — ~90 votes/min per client (auth user or IP).
//      Token-bucket style; legitimate thumb-spammers stay under, bots
//      get 429.
//   2. recordVoteOrReject — 5s dedupe per (client, unordered pair).
//      Rapid double-fire of the same battle (network retry, double-tap,
//      replay) is rejected so a single decision can never be counted
//      twice.
router.post("/vote", voteRateLimiter, async (req, res) => {
  const parsed = CastVoteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { winnerId, loserId } = parsed.data;

  if (winnerId === loserId) {
    return res.status(400).json({ error: "Winner and loser must be different" });
  }

  // Anonymous voting is allowed, so dedupe by IP when there's no user.
  // Reuses the same `clientKey` helper as the limiter so a client can
  // never be on different identities for the two protections (which
  // would let them bypass dedupe by exploiting the IP-format mismatch).
  const dedupe = recordVoteOrReject(clientKey(req), winnerId, loserId);
  if (!dedupe.ok) {
    res.setHeader("Retry-After", Math.ceil(dedupe.retryAfterMs / 1000));
    return res.status(429).json({
      error: "duplicate_vote",
      message: "This pair was just voted on. Wait a moment and try again.",
    });
  }

  try {
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

    // ELO with decaying K-factor (Blok B):
    //   K=32 while battle_count<20 (newcomers move fast)
    //   K=16 once stable (small corrections, low noise)
    // The K applied is each side's own K — winner and loser may differ.
    const kFor = (battleCount: number) => (battleCount < 20 ? 32 : 16);
    const winnerK = kFor(winner.battleCount);
    const loserK = kFor(loser.battleCount);
    const expectedWin = 1 / (1 + Math.pow(10, (loser.eloRating - winner.eloRating) / 400));
    const expectedLoss = 1 - expectedWin;
    const newWinnerElo = Math.round(winner.eloRating + winnerK * (1 - expectedWin));
    const newLoserElo = Math.round(loser.eloRating + loserK * (0 - expectedLoss));

    const [updatedWinner] = await db
      .update(thumbnailsTable)
      .set({
        wins: winner.wins + 1,
        eloRating: newWinnerElo,
        battleCount: winner.battleCount + 1,
      })
      .where(eq(thumbnailsTable.id, winnerId))
      .returning();

    const [updatedLoser] = await db
      .update(thumbnailsTable)
      .set({
        losses: loser.losses + 1,
        eloRating: newLoserElo,
        battleCount: loser.battleCount + 1,
      })
      .where(eq(thumbnailsTable.id, loserId))
      .returning();

    await db.insert(battlesTable).values({ winnerId, loserId });

    await db.insert(ratingHistoryTable).values([
      { thumbnailId: winnerId, rating: newWinnerElo },
      { thumbnailId: loserId, rating: newLoserElo },
    ]);

    const [{ total }] = await db.select({ total: count() }).from(battlesTable);

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
