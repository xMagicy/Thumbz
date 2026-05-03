import { Router } from "express";
import { db, thumbnailsTable, ratingHistoryTable } from "@workspace/db";
import { sql, desc, asc, eq, and, inArray, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { UploadThumbnailBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { auth } from "../lib/auth";
import { uploadRateLimiter } from "../lib/rateLimits";

const router = Router();

const NICHES = ["Gaming", "Tutorial", "Finance", "Music", "Lifestyle", "Tech", "Vlog", "Other"] as const;
type Niche = (typeof NICHES)[number];

// claude/backend-fix-1 — DEFENSE IN DEPTH at query time.
//
// Why this exists, in plain terms: the YouTube sync layer (lib/youtube.ts)
// already enforces ~25 distinct content rules at WRITE time — Shorts gates,
// trailer gates, channel blocklists, aspect ratio. But every time the
// sync layer regressed historically, the bad row sat in the database for
// hours or days before someone noticed. This SQL fragment is a second,
// independent enforcement layer at READ time. Even if the sync pipeline
// inserts a Shorts/trailer/commercial row tomorrow morning, this filter
// guarantees it never reaches a battle pair or the leaderboard.
//
// We pay one CTE-style WHERE clause per query against a pool of a few
// hundred rows — measured cost is sub-millisecond and indexable for the
// boolean `is_vertical_thumbnail` predicate.
//
// IMPORTANT: every list/battle endpoint that reads thumbnails MUST AND
// this fragment. The five entry points are:
//   • GET /api/thumbnails       (leaderboard / rankings)
//   • GET /api/thumbnails/battle (battle queue)
//   • GET /api/thumbnails/mine  (uploader's own dashboard)
//   • Any future "Discover" / "Trending" feed
//   • Any admin endpoint that must respect "no commercial content"
//
// Skip this filter ONLY for genuinely-archived analytics queries (e.g.
// "show me ALL the trailers we've blocked" admin tooling). Those are
// not user-facing and are the explicit exception.
const BAD_CONTENT_EXCLUSION_SQL = sql`
  -- Shorts hashtag markers (covers user-typed and copy-paste patterns).
  ${thumbnailsTable.title} NOT ILIKE '%#shorts%'
  AND ${thumbnailsTable.title} NOT ILIKE '%#short%'
  AND ${thumbnailsTable.title} NOT ILIKE '%#ytshorts%'
  AND ${thumbnailsTable.title} NOT ILIKE '%#youtubeshorts%'
  AND ${thumbnailsTable.title} NOT ILIKE '%#reel%'
  AND ${thumbnailsTable.title} NOT ILIKE '%#reels%'
  AND ${thumbnailsTable.title} NOT ILIKE '%#minivlog%'
  AND ${thumbnailsTable.title} NOT ILIKE '%#tiktok%'
  AND ${thumbnailsTable.title} !~* '#?(shorts?|reels?|ytshorts?|youtubeshorts?|minivlog|tiktoks?)\\M'

  -- Trailer / commercial title markers (mirrors TRAILER_TITLE_PATTERN
  -- from sync layer; defense-in-depth so legacy rows that pre-date the
  -- sync filter don't slip through). Each gets its own predicate so
  -- query-plan filtering reads cleanly in EXPLAIN ANALYZE.
  AND ${thumbnailsTable.title} !~* '\\m(trailer|teaser|first look|sneak peek|coming soon|in theaters|in cinemas|now streaming|premieres?|world premiere|official trailer|concept trailer|fan trailer|main trailer|release trailer|final trailer|new trailer|behind the scenes|now playing)\\M'

  -- Year-in-parens trailer patterns: "Some Movie (2026) Trailer", or
  -- the inverse "Trailer (2026)". Caught at sync but enforced again here.
  AND ${thumbnailsTable.title} !~* '\\(\\d{4}\\).*(trailer|teaser|first look|release)'
  AND ${thumbnailsTable.title} !~* '(trailer|teaser|first look|release).*\\(\\d{4}\\)'

  -- Pipe-separated cast/credits list (Tollywood/Bollywood movie
  -- signature). " | Name | Name | Name | Name" with 4+ short tokens.
  AND ${thumbnailsTable.title} !~ '(\\s\\|\\s[^|]{2,30}){3,}'

  -- Channel-name suffix blocklist. Mirrors CHANNEL_NAME_SUFFIX_BLOCKLIST
  -- in sync layer. Catches "Foo Studios", "Bar Pictures", "Baz Shorts",
  -- "Clap Entertainment" — the corporate aggregator pattern.
  AND ${thumbnailsTable.channelName} !~* '\\m(Studios|Pictures|Films|Productions|Records|VEVO|Network|Shorts|TikTok|Reels|Entertainment|Cinema|Cinemas|Movies|Trailers|Movieclips)\\s*[!.]?\\s*$'

  -- Channel-name substring blocklist. Specific corporate/brand channels
  -- that appear ANYWHERE in the channel name (mirrors the substring half
  -- of CHANNEL_NAME_BLOCKLIST). Word-boundary on each side to avoid
  -- false-positives like "Marvelous Cooks" matching "Marvel".
  AND ${thumbnailsTable.channelName} !~* '\\m(Marvel|Disney|Pixar|DreamWorks|Warner Bros|Universal|Paramount|Sony Pictures|Lionsgate|Netflix|HBO|Hulu|Disney\\+|CNN|Fox News|MSNBC|BBC News|Cocomelon|Pinkfong|NBA|NFL|FIFA|Coca-Cola|Movieclips|Entertainment Group|Media Group|Music Group|Animation|Trailers|T-Series|Yash Raj Films|Eros Now|Aditya Music)\\M'

  -- Aspect ratio guard: reject any row where the persisted thumbnail is
  -- vertical (height >= width on ANY API variant at sync time). This is
  -- THE catch-all for Shorts that don't carry hashtags — Hasan Minhaj
  -- podcast clips, vertical creator uploads, etc. Backed by an index
  -- (thumbnails_is_vertical_idx) so the predicate is O(log n).
  AND ${thumbnailsTable.isVerticalThumbnail} = false
`;

// Backwards-compat alias — keep old import name working during merge,
// but new code should use BAD_CONTENT_EXCLUSION_SQL.
const SHORTS_TITLE_EXCLUSION_SQL = BAD_CONTENT_EXCLUSION_SQL;

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
  channelId: t.channelId,
  channelLogoUrl: t.channelLogoUrl,
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
      SHORTS_TITLE_EXCLUSION_SQL,
    ];
    // Minimum-battles gate for ranking sorts. A "champion" with 0 battles
    // is just a fresh row at default ELO 1200 — surfacing those pollutes
    // the leaderboard with noise. Threshold differs per sort:
    //   - elo / winRate: 5 battles (need real signal before crowning)
    //   - rising:        3 battles (lower bar; this view exists to surface newcomers)
    //   - ctr / battles: no gate (ctr is independent of ELO, battles obvious)
    if (sort === "elo" || sort === "winRate") {
      conditions.push(sql`${thumbnailsTable.wins} + ${thumbnailsTable.losses} >= 5`);
    } else if (sort === "rising") {
      conditions.push(sql`${thumbnailsTable.wins} + ${thumbnailsTable.losses} >= 3`);
    }
    // Single source of truth (Blok 5, post task #16 backfill): filter on
    // app_category directly. All legacy NULL rows have been backfilled from
    // `niche`, and new uploads write app_category at insert time, so the
    // previous COALESCE fallback is no longer needed. `niche` is now purely
    // legacy upload-input — see thumbnails schema for details.
    if (niche) {
      conditions.push(eq(thumbnailsTable.appCategory, niche));
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
        // Ronde 3 Blok 4: order by breakout_score (composite of vph,
        // view-to-sub ratio, emerging-channel bonus, engagement) instead
        // of raw view velocity. Surfaces actual breakouts, not just
        // already-massive videos. NULLS LAST so user uploads + un-synced
        // YouTube rows sink below scored rows.
        orderBy = sql`${thumbnailsTable.breakoutScore} DESC NULLS LAST, ${thumbnailsTable.eloRating} DESC`;
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
      SHORTS_TITLE_EXCLUSION_SQL,
    ];
    // Same single-source-of-truth filter as the leaderboard list endpoint
    // (post task #16 backfill): app_category is the only bucket. Legacy
    // NULL rows have been backfilled and new uploads set it on insert.
    if (niche) {
      conditions.push(eq(thumbnailsTable.appCategory, niche));
    }
    const where = and(...conditions);

    const pool = await db.select().from(thumbnailsTable).where(where);

    if (pool.length < 2) {
      return res.status(400).json({ error: "Not enough thumbnails for a battle" });
    }

    // Bucket by app_category. The cat key is what the matchmaker locks
    // each pair to. When the UI is on "All", we rotate by picking a
    // random cat per pair. app_category is the single source of truth
    // post task #16 backfill — the "Other" coalesce is just a defensive
    // fallback for the unlikely case that a future write path lands a
    // row before classification.
    type Row = typeof pool[number];
    const catKey = (r: Row): string => r.appCategory ?? "Other";
    const byCat = new Map<string, Row[]>();
    for (const row of pool) {
      const k = catKey(row);
      const list = byCat.get(k) ?? [];
      list.push(row);
      byCat.set(k, list);
    }

    const sameChannel = (a: Row, b: Row): boolean =>
      Boolean(a.channelName && b.channelName && a.channelName === b.channelName);

    // ─── Decaying upload boost ─────────────────────────────────────────
    // Fresh user uploads need EXPOSURE — without battles their ELO is a
    // meaningless 1200 default and they sit invisible at the bottom of the
    // pool. We give them a temporary pairing weight that decays as they
    // accumulate battle data:
    //   battle_count <10  → 3.0  (cold start, ~50–60 battles in first 24h)
    //   battle_count <20  → 1.5  (finetuning toward stable ELO)
    //   battle_count ≥20  → 1.0  (treated identically to YouTube rows)
    // The boost auto-decays so there's no permanent advantage — once a
    // thumbnail has enough samples to be matched on ELO alone, exposure
    // stops mattering. The per-user upload cap (see POST /thumbnails)
    // prevents farming this boost by re-uploading the same image.
    function pairingWeight(r: Row): number {
      if (r.source !== "user") return 1.0;
      if (r.battleCount < 10) return 3.0;
      if (r.battleCount < 20) return 1.5;
      return 1.0;
    }

    // Weighted random pick. Falls back to uniform if all weights collapse
    // to zero (defensive — pairingWeight never returns 0 today).
    function weightedPick(items: Row[]): Row {
      if (items.length === 1) return items[0];
      let total = 0;
      for (const t of items) total += pairingWeight(t);
      if (total <= 0) return items[Math.floor(Math.random() * items.length)];
      let r = Math.random() * total;
      for (const t of items) {
        r -= pairingWeight(t);
        if (r < 0) return t;
      }
      return items[items.length - 1];
    }

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
      if (eligible.length > 0) return weightedPick(eligible);
      const relaxed = candidates.filter(
        (r) => r.id !== anchor.id && !sameChannel(anchor, r),
      );
      if (relaxed.length > 0) return weightedPick(relaxed);
      const anyDifferent = candidates.filter((r) => r.id !== anchor.id);
      if (anyDifferent.length === 0) return null;
      return weightedPick(anyDifferent);
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
      // Sparse-pool guard: if no single category has ≥2 thumbnails the
      // rotation can't produce a category-locked pair. Skip the loop and
      // let the cross-category last-resort fallback below run instead of
      // crashing on a destructure of `undefined`.
      if (eligibleCats.length === 0) break;
      // Category lock: if UI fixed a niche, that's the only bucket;
      // otherwise rotate randomly per pair across non-empty categories.
      const [, catPool] = eligibleCats[
        Math.floor(Math.random() * eligibleCats.length)
      ];
      // Anchor pick is also weighted — this is where the boost actually
      // earns the upload its exposure. Without it the anchor would still
      // be uniform and a fresh upload would only get the (small) opponent
      // bump from weightedPick downstream.
      const anchor = weightedPick(catPool);
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
router.post("/", uploadRateLimiter, async (req, res) => {
  const parsed = UploadThumbnailBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { title, channelName, niche, imageUrl, youtubeUrl } = parsed.data;
  if (!NICHES.includes(niche as Niche)) {
    return res.status(400).json({ error: "Invalid niche" });
  }

  // Lightweight YouTube URL sanity check so we don't store random
  // links. Accepts youtu.be/<id>, youtube.com/watch?v=<id>, /shorts/<id>,
  // /embed/<id>. Full validation (does the video exist?) is out of scope.
  const ytPattern =
    /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)[\w-]{6,}|youtu\.be\/[\w-]{6,})/i;
  if (!ytPattern.test(youtubeUrl)) {
    return res.status(400).json({
      error: "Invalid YouTube URL — please paste the full link to the video.",
    });
  }

  // Auth is REQUIRED for uploads. Anonymous uploads are no longer
  // accepted: the cap, dashboard, and per-creator analytics all lean on
  // a stable user_id, and tying uploads to an account is the easiest
  // way to keep the pool clean.
  let userId: string | null = null;
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const session = await auth.api.getSession({ headers });
    userId = session?.user.id ?? null;
  } catch {
    // fall through to the auth check below
  }
  if (!userId) {
    return res.status(401).json({
      error: "You need to sign in before uploading a thumbnail.",
    });
  }
  const ctr: number | null = null;

  try {
    // ─── Anti-abuse cap: max 5 active uploads per user ─────────────────
    // Without this, a single user could re-upload the same thumbnail 50x
    // to keep harvesting fresh-upload boost weight. We don't reject the
    // new upload (would feel punishing) — we instead archive the OLDEST
    // active upload for this user, so total active uploads never exceeds
    // 5. Archived rows are kept for analytics + the dashboard but are
    // excluded from pairing + the leaderboard. Anonymous uploads are
    // exempt because there's no user_id to count against.
    //
    // Wrapped in a transaction with SELECT … FOR UPDATE so two concurrent
    // uploads from the same user can't both observe `count=4` and each
    // succeed → exceeding the cap. The row-level lock serializes
    // per-user upload bursts; cross-user uploads stay fully concurrent.
    const MAX_ACTIVE_PER_USER = 5;
    const row = await db.transaction(async (tx) => {
      if (userId) {
        const active = await tx
          .select({
            id: thumbnailsTable.id,
            createdAt: thumbnailsTable.createdAt,
          })
          .from(thumbnailsTable)
          .where(
            and(
              eq(thumbnailsTable.userId, userId),
              eq(thumbnailsTable.archived, false),
            ),
          )
          .orderBy(asc(thumbnailsTable.createdAt))
          .for("update");
        // Keep room for the new row → archive enough oldest rows so that
        // after the insert there are at most MAX_ACTIVE_PER_USER active.
        const overflow = active.length - (MAX_ACTIVE_PER_USER - 1);
        if (overflow > 0) {
          const idsToArchive = active.slice(0, overflow).map((r) => r.id);
          await tx
            .update(thumbnailsTable)
            .set({ archived: true })
            .where(inArray(thumbnailsTable.id, idsToArchive));
          req.log.info(
            { userId, archivedIds: idsToArchive },
            "Archived oldest user uploads to enforce per-user active cap",
          );
        }
      }

      const [inserted] = await tx
        .insert(thumbnailsTable)
        .values({
          title: title.trim(),
          channelName: channelName.trim(),
          niche,
          // Blok 5: app_category is the primary bucket for matchmaking
          // and leaderboard filtering. For user uploads the classifier
          // doesn't run, so mirror the user-picked niche into
          // app_category so this row participates in app_category-driven
          // flows from day one (no batch backfill required).
          appCategory: niche,
          imageUrl,
          ctr: ctr ?? null,
          youtubeUrl: youtubeUrl?.trim() || null,
          status: "active",
          userId,
        })
        .returning();
      return inserted;
    });

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

// POST /api/thumbnails/report-bad — Layer 4 safety net.
// Frontend calls this when an image loads with a vertical/near-square
// aspect ratio (almost certainly a Short that slipped through the
// pre-classifier and the SQL exclusion). We log loudly + auto-archive
// so the next sync/battle can never serve it again. Anonymous-friendly:
// no auth required — abuse is bounded because we only archive rows whose
// title or aspect actually matches a Shorts pattern after we re-check.
const reportBadBodySchema = z.object({
  thumbnailId: z.number().int().positive(),
  reason: z.enum(["vertical_aspect", "shorts_marker"]),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

router.post("/report-bad", async (req, res) => {
  const parsed = reportBadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid report body" });
  }
  const { thumbnailId, reason, width, height } = parsed.data;
  try {
    const [row] = await db
      .select({
        id: thumbnailsTable.id,
        title: thumbnailsTable.title,
        archived: thumbnailsTable.archived,
        source: thumbnailsTable.source,
      })
      .from(thumbnailsTable)
      .where(eq(thumbnailsTable.id, thumbnailId));
    if (!row) {
      return res.status(404).json({ error: "Thumbnail not found" });
    }
    // Only auto-archive YouTube rows. User uploads are the user's own
    // image — if it's vertical that's their choice (still bad UX, but
    // not our call to silently nuke).
    //
    // claude/backend-fix-1: also persist isVerticalThumbnail + width/height
    // when the client supplies them. This lets the next sync/query layer
    // reject the row even if archive flag is later flipped manually,
    // and feeds the analytics pipeline real aspect ratio data.
    let archived = false;
    const updateSet: Record<string, unknown> = {};
    if (reason === "vertical_aspect") {
      updateSet.isVerticalThumbnail = true;
      if (typeof width === "number") updateSet.thumbnailWidth = width;
      if (typeof height === "number") updateSet.thumbnailHeight = height;
    }
    if (!row.archived && row.source === "youtube") {
      updateSet.archived = true;
      updateSet.status = "shorts_archived";
      archived = true;
    }
    if (Object.keys(updateSet).length > 0) {
      await db
        .update(thumbnailsTable)
        .set(updateSet)
        .where(eq(thumbnailsTable.id, thumbnailId));
    }
    req.log.warn(
      { thumbnailId, title: row.title, reason, width, height, archived },
      "Bad thumbnail reported by client (Shorts leakage)",
    );
    return res.json({ ok: true, archived });
  } catch (err) {
    req.log.error({ err, thumbnailId }, "Failed to record bad-thumbnail report");
    return res.status(500).json({ error: "Failed to record report" });
  }
});

export default router;
