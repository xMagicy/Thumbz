import { Router } from "express";
import { db, thumbnailsTable, eloHistoryTable } from "@workspace/db";
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

const toDto = (t: typeof thumbnailsTable.$inferSelect) => ({
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
});

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
    res.json(rows.map(toDto));
  } catch (err) {
    req.log.error({ err }, "Failed to list thumbnails");
    res.status(500).json({ error: "Failed to list thumbnails" });
  }
});

// GET /api/thumbnails/battle?niche= — two random active thumbnails
router.get("/battle", async (req, res) => {
  try {
    const niche = normalizeNiche(typeof req.query.niche === "string" ? req.query.niche : undefined);

    const conditions: SQL[] = [eq(thumbnailsTable.status, "active")];
    if (niche) conditions.push(eq(thumbnailsTable.niche, niche));
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    const rows = await db
      .select()
      .from(thumbnailsTable)
      .where(where)
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

// POST /api/thumbnails — user-submitted thumbnail. Saved as status="pending" until admin approval.
// If the request carries a valid session, the resulting row is tagged with userId so
// the uploader can find it back in their dashboard. Anonymous uploads are still allowed
// (userId stays NULL), matching the same pattern used for the seed thumbnails.
router.post("/", async (req, res) => {
  const parsed = UploadThumbnailBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { title, channelName, niche, imageUrl, ctr, youtubeUrl } = parsed.data;
  if (!NICHES.includes(niche as Niche)) {
    return res.status(400).json({ error: "Invalid niche" });
  }

  // Best-effort session resolution — never blocks the upload, but tags it
  // when an authenticated user is present.
  let userId: string | null = null;
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const session = await auth.api.getSession({ headers });
    userId = session?.user.id ?? null;
  } catch {
    // Ignore — anonymous upload path.
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

// GET /api/thumbnails/mine — list the current user's uploaded thumbnails.
// Includes pending + active rows, sorted newest first. Auth required.
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(thumbnailsTable)
      .where(eq(thumbnailsTable.userId, req.user!.id))
      .orderBy(desc(thumbnailsTable.createdAt));
    res.json(rows.map(toDto));
  } catch (err) {
    req.log.error({ err }, "Failed to list user thumbnails");
    res.status(500).json({ error: "Failed to list thumbnails" });
  }
});

// GET /api/thumbnails/:id/elo-history — history points for the per-thumbnail
// sparkline on the dashboard. Public (no auth) so the leaderboard detail
// modal can show it for any thumbnail too. Capped at 100 most-recent points.
router.get("/:id/elo-history", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid thumbnail id" });
  }
  try {
    const rows = await db
      .select({
        id: eloHistoryTable.id,
        eloRating: eloHistoryTable.eloRating,
        recordedAt: eloHistoryTable.recordedAt,
      })
      .from(eloHistoryTable)
      .where(eq(eloHistoryTable.thumbnailId, id))
      .orderBy(asc(eloHistoryTable.recordedAt))
      .limit(100);
    res.json(
      rows.map((r) => ({
        id: r.id,
        eloRating: r.eloRating,
        recordedAt: r.recordedAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err, thumbnailId: id }, "Failed to load ELO history");
    res.status(500).json({ error: "Failed to load ELO history" });
  }
});

// PATCH /api/thumbnails/:id/ctr — owner-only update to the thumbnail's CTR.
// Lets the uploader fill in their real YouTube CTR once it's known. Body
// validates 0 <= ctr <= 100, or null to clear.
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
    res.json(toDto(updated));
  } catch (err) {
    req.log.error({ err, thumbnailId: id }, "Failed to update CTR");
    res.status(500).json({ error: "Failed to update CTR" });
  }
});

export default router;
