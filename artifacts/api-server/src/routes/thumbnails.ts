import { Router } from "express";
import { db, thumbnailsTable, ratingHistoryTable } from "@workspace/db";
import { sql, desc, asc, eq, and, type SQL } from "drizzle-orm";
import { UploadThumbnailBody } from "@workspace/api-zod";

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
    const sort = (["elo", "winRate", "ctr", "battles"] as const).includes(sortRaw as never)
      ? (sortRaw as "elo" | "winRate" | "ctr" | "battles")
      : "elo";

    // Always restrict to active rows; pending uploads await admin review.
    const conditions: SQL[] = [eq(thumbnailsTable.status, "active")];
    if (niche) conditions.push(eq(thumbnailsTable.niche, niche));
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

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

// GET /api/thumbnails/battle?niche=&count=N — N random active thumbnail pairs
// (default 1, max 10). Client uses count>1 to maintain a prefetched queue so
// swipes feel instant — no network on the critical path between votes.
router.get("/battle", async (req, res) => {
  try {
    const niche = normalizeNiche(typeof req.query.niche === "string" ? req.query.niche : undefined);

    // Parse count: clamp to [1, 10], default 1. Anything unparseable → 1.
    const rawCount = typeof req.query.count === "string" ? Number(req.query.count) : 1;
    const count =
      Number.isFinite(rawCount) && rawCount >= 1
        ? Math.min(10, Math.floor(rawCount))
        : 1;

    const conditions: SQL[] = [eq(thumbnailsTable.status, "active")];
    if (niche) conditions.push(eq(thumbnailsTable.niche, niche));
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    // Fetch up to count*2 random rows in one query, then chunk into pairs.
    // If the niche has fewer rows than requested we silently return fewer
    // pairs — never less than 1, otherwise we 400 (handled below).
    const rows = await db
      .select()
      .from(thumbnailsTable)
      .where(where)
      .orderBy(sql`RANDOM()`)
      .limit(count * 2);

    if (rows.length < 2) {
      return res.status(400).json({ error: "Not enough thumbnails for a battle" });
    }

    const pairs = [];
    for (let i = 0; i + 1 < rows.length; i += 2) {
      pairs.push({ left: toDto(rows[i]), right: toDto(rows[i + 1]) });
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

// POST /api/thumbnails — user-submitted thumbnail. Saved as status="pending" until admin approval.
router.post("/", async (req, res) => {
  const parsed = UploadThumbnailBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { title, channelName, niche, imageUrl, ctr, youtubeUrl } = parsed.data;
  if (!NICHES.includes(niche as Niche)) {
    return res.status(400).json({ error: "Invalid niche" });
  }

  try {
    const [row] = await db
      .insert(thumbnailsTable)
      .values({
        title: title.trim(),
        channelName: channelName.trim(),
        niche,
        imageUrl,
        ctr: ctr ?? null,
        youtubeUrl: youtubeUrl?.trim() || null,
        status: "pending",
      })
      .returning();

    req.log.info({ thumbnailId: row.id, niche, status: row.status }, "Thumbnail submitted");

    return res.status(201).json(toDto(row));
  } catch (err) {
    req.log.error({ err }, "Failed to submit thumbnail");
    return res.status(500).json({ error: "Failed to submit thumbnail" });
  }
});

export default router;
