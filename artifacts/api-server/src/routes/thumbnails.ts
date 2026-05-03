import { Router } from "express";
import { db, thumbnailsTable, ratingHistoryTable } from "@workspace/db";
import { sql, desc, asc, eq, and, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { UploadThumbnailBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { auth } from "../lib/auth";

const router = Router();

const NICHES = ["Gaming", "Tutorial", "Finance", "Music", "Lifestyle", "Tech", "Vlog", "Other"] as const;
type Niche = (typeof NICHES)[number];

function normalizeNiche(raw: string | undefined): Niche | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return undefined;
  const matched = NICHES.find((n) => n.toLowerCase() === trimmed.toLowerCase());
  return matched;
}

const toDto = (
  t: typeof thumbnailsTable.$inferSelect,
  recentRatings: number[] = [],
) => ({
  id: t.id,
  title: t.title,
  imageUrl: t.imageUrl,
  channelName: t.channelName,
  niche: t.niche,
  ctr: t.ctr,
  youtubeUrl: t.youtubeUrl,
  status: t.status,
  wins: t.wins,
  losses: t.losses,
  eloRating: t.eloRating,
  winRate:
    t.wins + t.losses > 0
      ? Math.round((t.wins / (t.wins + t.losses)) * 100 * 10) / 10
      : null,
  recentRatings,
  // Phase B — YouTube provenance + velocity (FPH = views/hour).
  // All nullable: user-uploaded thumbnails won't have these.
  source: t.source,
  youtubeVideoId: t.youtubeVideoId,
  viewCount: t.viewCount,
  viewVelocity: t.viewVelocity,
  publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
  // Sourcing v2 (Blok A/E/F).
  appCategory: t.appCategory,
  archived: t.archived,
  battleCount: t.battleCount,
  categoryId: t.categoryId,
  subscriberCount: t.subscriberCount,
  viewToSubRatio: t.viewToSubRatio,
  // Blok G.
  viewsPerHour: t.viewsPerHour,
  channelAgeDays: t.channelAgeDays,
  isEmergingChannel: t.isEmergingChannel,
  breakoutScore: t.breakoutScore,
});

// Batched fetch of the most-recent N rating snapshots for a set of thumbnail
// IDs. Returns a Map<thumbnailId, number[]> with values in chronological
// order (oldest first). Replaces the previous N+1 per-row fetch from the
// leaderboard sparklines.
async function fetchRecentRatingsByThumbnail(
  ids: number[],
  perThumbnail = 20,
): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (ids.length === 0) return out;
  // Window-function query: get the most recent `perThumbnail` rows per
  // thumbnail in a single round-trip, then re-emit chronologically.
  // IDs are integers we just selected ourselves so it is safe to inline
  // them with sql.raw — drizzle's `${ids}` would wrap the array in extra
  // parens which Postgres rejects for ANY(...).
  const idList = ids.map((n) => Number(n)).join(",");
  const limit = Math.max(1, Math.floor(perThumbnail));
  const rows = (await db.execute(sql`
    SELECT thumbnail_id, rating, created_at
    FROM (
      SELECT thumbnail_id, rating, created_at,
        ROW_NUMBER() OVER (
          PARTITION BY thumbnail_id ORDER BY created_at DESC
        ) AS rn
      FROM rating_history
      WHERE thumbnail_id IN (${sql.raw(idList)})
    ) ranked
    WHERE rn <= ${sql.raw(String(limit))}
    ORDER BY thumbnail_id ASC, created_at ASC
  `)) as unknown as { rows: Array<{ thumbnail_id: number; rating: number }> };
  for (const r of rows.rows) {
    const arr = out.get(r.thumbnail_id) ?? [];
    arr.push(r.rating);
    out.set(r.thumbnail_id, arr);
  }
  return out;
}

// GET /api/thumbnails?niche=&sort=elo|winRate|ctr|battles
router.get("/", async (req, res) => {
  try {
    const niche = normalizeNiche(typeof req.query.niche === "string" ? req.query.niche : undefined);
    const sortRaw = typeof req.query.sort === "string" ? req.query.sort : "elo";
    const sort = (["elo", "winRate", "ctr", "battles", "rising"] as const).includes(sortRaw as never)
      ? (sortRaw as "elo" | "winRate" | "ctr" | "battles" | "rising")
      : "elo";

    // Always restrict to active, non-archived rows. Pending uploads await
    // admin review; archived rows are pool-curation casualties (chronic
    // underperformers or category overflow) and shouldn't show on the board.
    const conditions: SQL[] = [
      eq(thumbnailsTable.status, "active"),
      eq(thumbnailsTable.archived, false),
    ];
    // Single source of truth (Blok 5): filter on app_category as the primary
    // bucket, falling back to legacy `niche` for rows where app_category is
    // still NULL (older user uploads pre-backfill). New uploads write
    // app_category at insert time so this fallback gradually empties.
    if (niche) {
      conditions.push(
        sql`COALESCE(${thumbnailsTable.appCategory}, ${thumbnailsTable.niche}) = ${niche}`,
      );
    }
    const where = and(...conditions);

    // ORDER BY clause per sort. NULLS LAST so missing CTRs sink to the bottom on a CTR sort.
    let orderBy;
    switch (sort) {
      case "winRate":
        orderBy = sql`CASE WHEN ${thumbnailsTable.wins} + ${thumbnailsTable.losses} = 0 THEN -1 ELSE (${thumbnailsTable.wins}::float / (${thumbnailsTable.wins} + ${thumbnailsTable.losses})) END DESC, ${thumbnailsTable.eloRating} DESC`;
        break;
      case "ctr":
        orderBy = sql`${thumbnailsTable.ctr} DESC NULLS LAST, ${thumbnailsTable.eloRating} DESC`;
        break;
      case "battles":
        orderBy = sql`(${thumbnailsTable.wins} + ${thumbnailsTable.losses}) DESC, ${thumbnailsTable.eloRating} DESC`;
        break;
      case "rising":
        // FPH = views per hour. NULLS LAST so user-uploaded thumbnails
        // (which have no YouTube velocity yet) sink below YouTube rows.
        orderBy = sql`${thumbnailsTable.viewVelocity} DESC NULLS LAST, ${thumbnailsTable.eloRating} DESC`;
        break;
      case "elo":
      default:
        orderBy = desc(thumbnailsTable.eloRating);
    }
    void asc; // keep import for symmetry

    const rows = await db.select().from(thumbnailsTable).where(where).orderBy(orderBy);
    // Batched history fetch — one extra round-trip total instead of N (one
    // per row). Lets the leaderboard render sparklines instantly without
    // saturating the browser's 6-per-origin connection limit and starving
    // the battle/image preload paths.
    const histories = await fetchRecentRatingsByThumbnail(rows.map((r) => r.id));
    res.json(rows.map((r) => toDto(r, histories.get(r.id) ?? [])));
  } catch (err) {
    req.log.error({ err }, "Failed to list thumbnails");
    res.status(500).json({ error: "Failed to list thumbnails" });
  }
});

// GET /api/thumbnails/battle?niche=&count=N — N quality-matched thumbnail pairs
// (default 1, max 10). Client uses count>1 to maintain a prefetched queue so
// swipes feel instant — no network on the critical path between votes.
//
// Matchmaking (Blok C/F):
//   • Category lock — battles are always within ONE category. When the UI
//     asks for "All", we rotate: pick a random non-empty app_category per
//     pair (so the user sees variety across battles, but each individual
//     battle is fair).
//   • Tier match — within category, prefer same view-tier first.
//   • ELO proximity — within tier, prefer opponents with |ΔELO|≤150,
//     fall back to ≤300, then any.
//   • Different channel — never pair two videos from the same channel.
//   • Cold-start calibration — if either side has battle_count<5, lock the
//     opponent to the 1100-1300 ELO mid-tier of the same category. Prevents
//     a brand-new thumbnail from being thrown straight at a 1500 champion.
//   • Archived rows are excluded entirely.
//
// View tiers (Blok C, recalibrated to brief):
//   user   – source='user' (no view_count, judged on design only)
//   micro  – 25K – 250K
//   mid    – 250K – 1M
//   macro  – 1M – 5M
//   mega   – 5M+
//
// We fetch the candidate pool in one query (~hundreds of rows, cheap) and
// pair entirely in memory.
type Tier = "user" | "micro" | "mid" | "macro" | "mega";

function viewTier(row: { source: string | null; viewCount: number | null }): Tier {
  if (row.source !== "youtube" || row.viewCount === null) return "user";
  const v = row.viewCount;
  if (v >= 5_000_000) return "mega";
  if (v >= 1_000_000) return "macro";
  if (v >= 250_000) return "mid";
  return "micro";
}

const CALIBRATION_BATTLES = 5;
// Brief: cold-start opponents fall in the 1100-1300 band of the same
// category. Widened from 1150-1250 so small categories with few mid-tier
// rows still produce a calibration partner before falling through.
const CALIBRATION_ELO_LO = 1100;
const CALIBRATION_ELO_HI = 1300;
const ELO_NEAR = 150;
const ELO_FAR = 300;

router.get("/battle", async (req, res) => {
  try {
    const niche = normalizeNiche(typeof req.query.niche === "string" ? req.query.niche : undefined);

    const rawCount = typeof req.query.count === "string" ? Number(req.query.count) : 1;
    const count =
      Number.isFinite(rawCount) && rawCount >= 1
        ? Math.min(10, Math.floor(rawCount))
        : 1;

    // Battle pool: active, non-archived. Niche filter applies if the
    // client locked the leaderboard tab; "All" returns the full pool and
    // we rotate categories per pair below.
    const conditions: SQL[] = [
      eq(thumbnailsTable.status, "active"),
      eq(thumbnailsTable.archived, false),
    ];
    // Same single-source-of-truth filter as the leaderboard list endpoint:
    // primary bucket is app_category, with niche as legacy fallback for old
    // user uploads where app_category is still NULL.
    if (niche) {
      conditions.push(
        sql`COALESCE(${thumbnailsTable.appCategory}, ${thumbnailsTable.niche}) = ${niche}`,
      );
    }
    const where = and(...conditions);

    const pool = await db.select().from(thumbnailsTable).where(where);

    if (pool.length < 2) {
      return res.status(400).json({ error: "Not enough thumbnails for a battle" });
    }

    // Bucket by app_category (with niche fallback for legacy/user rows).
    // The cat key is what the matchmaker locks each pair to. When the UI
    // is on "All", we rotate by picking a random cat per pair.
    type Row = typeof pool[number];
    const catKey = (r: Row): string => r.appCategory ?? r.niche ?? "Other";
    const byCat = new Map<string, Row[]>();
    for (const row of pool) {
      const k = catKey(row);
      const list = byCat.get(k) ?? [];
      list.push(row);
      byCat.set(k, list);
    }

    const sameChannel = (a: Row, b: Row): boolean =>
      Boolean(a.channelName && b.channelName && a.channelName === b.channelName);

    // Find an opponent for `anchor` from `candidates` honoring:
    //   - id ≠ anchor.id
    //   - different channel
    //   - not already used in this request (to avoid repeat-pairs)
    //   - falls back to 'any not-anchor' last
    function findOpponent(
      anchor: Row,
      candidates: Row[],
      used: Set<number>,
    ): Row | null {
      const eligible = candidates.filter(
        (r) => r.id !== anchor.id && !sameChannel(anchor, r) && !used.has(r.id),
      );
      if (eligible.length > 0) {
        return eligible[Math.floor(Math.random() * eligible.length)];
      }
      const relaxed = candidates.filter(
        (r) => r.id !== anchor.id && !sameChannel(anchor, r),
      );
      if (relaxed.length > 0) {
        return relaxed[Math.floor(Math.random() * relaxed.length)];
      }
      const anyDifferent = candidates.filter((r) => r.id !== anchor.id);
      if (anyDifferent.length === 0) return null;
      return anyDifferent[Math.floor(Math.random() * anyDifferent.length)];
    }

    // Run the full Blok C/F matchmaking ladder for one anchor:
    //   1. Cold-start calibration   — anchor has battle_count<5
    //      → opponent in [1100, 1300] ELO, same category
    //   2. Same tier + ELO ≤ 150
    //   3. Same tier + ELO ≤ 300
    //   4. Same category + ELO ≤ 150
    //   5. Same category + ELO ≤ 300
    //   6. Same category, any ELO (veterans only)
    //   7. Last-resort: any in category pool incl. newcomers
    function pickOpponentFor(
      anchor: Row,
      categoryPool: Row[],
      used: Set<number>,
    ): Row | null {
      const anchorTier = viewTier(anchor);
      const anchorElo = anchor.eloRating;

      if (anchor.battleCount < CALIBRATION_BATTLES) {
        const calibration = categoryPool.filter(
          (r) =>
            r.eloRating >= CALIBRATION_ELO_LO &&
            r.eloRating <= CALIBRATION_ELO_HI &&
            r.battleCount >= CALIBRATION_BATTLES,
        );
        const op = findOpponent(anchor, calibration, used);
        if (op) return op;
        // Fall through if calibration tier is empty (e.g. fresh deploy).
      }

      // Symmetric cold-start: when the anchor is established, exclude
      // newcomers from the regular paths so a 1500 vet never gets paired
      // with a fresh 1200 newcomer outside that newcomer's calibration
      // window. Newcomers are still picked as anchors elsewhere and get
      // their own calibration branch above. We only fall back to including
      // newcomers as a last resort (full-pool sweep below).
      const veteranPool =
        anchor.battleCount >= CALIBRATION_BATTLES
          ? categoryPool.filter((r) => r.battleCount >= CALIBRATION_BATTLES)
          : categoryPool;

      const sameTier = veteranPool.filter((r) => viewTier(r) === anchorTier);
      const tierNear = sameTier.filter(
        (r) => Math.abs(r.eloRating - anchorElo) <= ELO_NEAR,
      );
      let op = findOpponent(anchor, tierNear, used);
      if (op) return op;

      const tierFar = sameTier.filter(
        (r) => Math.abs(r.eloRating - anchorElo) <= ELO_FAR,
      );
      op = findOpponent(anchor, tierFar, used);
      if (op) return op;

      const catNear = veteranPool.filter(
        (r) => Math.abs(r.eloRating - anchorElo) <= ELO_NEAR,
      );
      op = findOpponent(anchor, catNear, used);
      if (op) return op;

      const catFar = veteranPool.filter(
        (r) => Math.abs(r.eloRating - anchorElo) <= ELO_FAR,
      );
      op = findOpponent(anchor, catFar, used);
      if (op) return op;

      op = findOpponent(anchor, veteranPool, used);
      if (op) return op;

      // Last-resort: fall back to anyone in the category pool, including
      // newcomers. Better an unbalanced pair than no pair in tiny pools.
      return findOpponent(anchor, categoryPool, used);
    }

    const usedIds = new Set<number>();
    const pairs: Array<{ left: ReturnType<typeof toDto>; right: ReturnType<typeof toDto> }> = [];
    const eligibleCats = [...byCat.entries()].filter(([, l]) => l.length >= 2);

    for (let i = 0; i < count; i++) {
      // Category lock: if UI fixed a niche, that's the only bucket;
      // otherwise rotate randomly per pair across non-empty categories.
      const [, catPool] = eligibleCats[
        Math.floor(Math.random() * eligibleCats.length)
      ];
      const anchor = catPool[Math.floor(Math.random() * catPool.length)];
      const opponent = pickOpponentFor(anchor, catPool, usedIds);
      if (!opponent) continue;
      usedIds.add(anchor.id);
      usedIds.add(opponent.id);
      pairs.push({ left: toDto(anchor), right: toDto(opponent) });
    }

    // Last-resort: if the rotation produced nothing usable (tiny pool),
    // fall back to any two distinct rows so the client never sees an
    // empty array.
    if (pairs.length === 0 && pool.length >= 2) {
      const a = pool[Math.floor(Math.random() * pool.length)];
      const others = pool.filter((r) => r.id !== a.id);
      const b = others[Math.floor(Math.random() * others.length)];
      pairs.push({ left: toDto(a), right: toDto(b) });
    }

    if (pairs.length === 0) {
      return res.status(400).json({ error: "Not enough thumbnails for a battle" });
    }

    return res.json({ pairs });
  } catch (err) {
    req.log.error({ err }, "Failed to get battle pair");
    return res.status(500).json({ error: "Failed to get battle pair" });
  }
});

// GET /api/thumbnails/:id/rating-history — recorded ELO snapshots, oldest first.
// Capped server-side to the most recent 50 points so the chart payload stays
// small even after a thumbnail accumulates thousands of battles.
router.get("/:id/rating-history", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid thumbnail id" });
  }

  try {
    const [thumb] = await db
      .select({ id: thumbnailsTable.id, eloRating: thumbnailsTable.eloRating })
      .from(thumbnailsTable)
      .where(eq(thumbnailsTable.id, id));

    if (!thumb) {
      return res.status(404).json({ error: `Thumbnail ${id} not found` });
    }

    // Pull the most recent N points DESC, then reverse to chronological order
    // for the client. We do not have a single SQL `ORDER BY ... LIMIT` followed
    // by a re-sort in one statement here; reversing in JS is fine for N<=50.
    const recent = await db
      .select({
        rating: ratingHistoryTable.rating,
        createdAt: ratingHistoryTable.createdAt,
      })
      .from(ratingHistoryTable)
      .where(eq(ratingHistoryTable.thumbnailId, id))
      .orderBy(desc(ratingHistoryTable.createdAt))
      .limit(50);

    const points = recent
      .slice()
      .reverse()
      .map((p) => ({
        rating: p.rating,
        createdAt: p.createdAt.toISOString(),
      }));

    return res.json({
      thumbnailId: thumb.id,
      currentRating: thumb.eloRating,
      points,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load rating history");
    return res.status(500).json({ error: "Failed to load rating history" });
  }
});

// POST /api/thumbnails — user-submitted thumbnail. Saved as status="active"
// so the upload immediately enters the battle pool — the user instantly
// sees their thumbnail show up in real battles, which is a core part of
// the product feel ("upload → see it live"). Trust + moderation can be
// layered on later via report flagging or a soft-shadow status, but for
// now uploads are first-class.
// If a Better Auth session cookie is present, tag the row with the uploader's
// userId so it surfaces in their dashboard. Anonymous uploads are still
// allowed (userId stays NULL).
router.post("/", async (req, res) => {
  const parsed = UploadThumbnailBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { title, channelName, niche, imageUrl, ctr, youtubeUrl } = parsed.data;
  if (!NICHES.includes(niche as Niche)) {
    return res.status(400).json({ error: "Invalid niche" });
  }

  // Best-effort session resolution — never blocks the upload.
  let userId: string | null = null;
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const session = await auth.api.getSession({ headers });
    userId = session?.user.id ?? null;
  } catch {
    // Anonymous upload — fine.
  }

  try {
    const [row] = await db
      .insert(thumbnailsTable)
      .values({
        title: title.trim(),
        channelName: channelName.trim(),
        niche,
        // Blok 5: app_category is the primary bucket for matchmaking and
        // leaderboard filtering. For user uploads the classifier doesn't
        // run, so mirror the user-picked niche into app_category so this
        // row participates in app_category-driven flows from day one
        // (no batch backfill required).
        appCategory: niche,
        imageUrl,
        ctr: ctr ?? null,
        youtubeUrl: youtubeUrl?.trim() || null,
        status: "active",
        userId,
      })
      .returning();

    req.log.info(
      { thumbnailId: row.id, niche, status: row.status, hasUser: !!userId },
      "Thumbnail submitted",
    );

    return res.status(201).json(toDto(row));
  } catch (err) {
    req.log.error({ err }, "Failed to submit thumbnail");
    return res.status(500).json({ error: "Failed to submit thumbnail" });
  }
});

// GET /api/thumbnails/mine — the signed-in user's uploads, newest first.
// Includes pending + active + rejected so the uploader sees the full state.
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(thumbnailsTable)
      .where(eq(thumbnailsTable.userId, req.user!.id))
      .orderBy(desc(thumbnailsTable.createdAt));
    const histories = await fetchRecentRatingsByThumbnail(rows.map((r) => r.id));
    res.json(rows.map((r) => toDto(r, histories.get(r.id) ?? [])));
  } catch (err) {
    req.log.error({ err }, "Failed to list user thumbnails");
    res.status(500).json({ error: "Failed to list thumbnails" });
  }
});

// PATCH /api/thumbnails/:id/ctr — owner-only update to the thumbnail's CTR.
const ctrBodySchema = z.object({
  ctr: z.union([z.number().min(0).max(100), z.null()]),
});

router.patch("/:id/ctr", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid thumbnail id" });
  }
  const parsed = ctrBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ctr must be a number 0-100 or null" });
  }
  try {
    const [existing] = await db
      .select({ userId: thumbnailsTable.userId })
      .from(thumbnailsTable)
      .where(eq(thumbnailsTable.id, id));
    if (!existing) {
      return res.status(404).json({ error: "Thumbnail not found" });
    }
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ error: "Not your thumbnail" });
    }
    const [updated] = await db
      .update(thumbnailsTable)
      .set({ ctr: parsed.data.ctr })
      .where(eq(thumbnailsTable.id, id))
      .returning();
    return res.json(toDto(updated));
  } catch (err) {
    req.log.error({ err, thumbnailId: id }, "Failed to update CTR");
    return res.status(500).json({ error: "Failed to update CTR" });
  }
});

export default router;
