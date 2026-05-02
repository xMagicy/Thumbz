import { Router } from "express";
import { db, thumbnailsTable } from "@workspace/db";
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
