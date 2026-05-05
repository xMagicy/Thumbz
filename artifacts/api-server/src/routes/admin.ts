import { Router, type Request, type Response, type NextFunction } from "express";
import { db, thumbnailsTable } from "@workspace/db";
import { count, gte, sql } from "drizzle-orm";
import { syncTrendingVideos } from "../lib/youtube";
import { withSyncLock } from "../lib/syncLock";

const router: Router = Router();

/**
 * Admin token gate.
 *
 * Requires header `Authorization: Bearer <ADMIN_TOKEN>` matching the
 * ADMIN_TOKEN env secret. If ADMIN_TOKEN is not configured, the entire
 * /admin namespace is locked (503) — fail-closed by default so an
 * unset secret can never accidentally expose privileged operations.
 *
 * This is intentionally simple (single shared token) because /admin is
 * for operator use, not multi-user. When we need real role-based
 * access, swap in the Better Auth session + isAdmin flag.
 */
function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env["ADMIN_TOKEN"];
  if (!expected) {
    return res.status(503).json({
      error: "admin_disabled",
      message: "ADMIN_TOKEN is not configured on the server.",
    });
  }
  const header = req.headers["authorization"];
  const token =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : null;
  if (!token || token !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

router.use(requireAdminToken);

/**
 * POST /api/admin/sync-youtube
 *
 * Manually trigger a YouTube trending sync. Useful for testing right
 * after adding the YOUTUBE_API_KEY without waiting for the 6h cron.
 *
 * Requires the admin token (see requireAdminToken above).
 */
router.post("/sync-youtube", async (req, res) => {
  try {
    const regions =
      typeof req.query["regions"] === "string"
        ? req.query["regions"].split(",").map((s) => s.trim())
        : undefined;
    const maxResults =
      typeof req.query["max"] === "string"
        ? Number(req.query["max"])
        : undefined;

    // Mutex-wrap the manual trigger too, otherwise an operator hitting
    // this endpoint right when the 6h cron fires would do duplicate
    // upserts and corrupt the per-channel / region / category balance
    // heuristics that depend on a stable single-pass view of the pool.
    const locked = await withSyncLock(() =>
      syncTrendingVideos({ regions, maxResults }),
    );
    if (!locked.ok) {
      return res.status(409).json({
        error: "sync_in_progress",
        message: "A YouTube sync is already running. Try again in a minute.",
      });
    }
    const result = locked.result;
    if (!result.ok) {
      return res.status(503).json({
        error: "sync_unavailable",
        reason: result.reason,
        message:
          result.reason === "missing_api_key"
            ? "YOUTUBE_API_KEY is not configured."
            : "YouTube sync is unavailable.",
      });
    }
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Manual YouTube sync failed");
    return res.status(500).json({ error: "sync_failed" });
  }
});

/**
 * GET /api/admin/sync-status
 *
 * Read-only health check for the YouTube sync. Returns the last time
 * the sync touched any thumbnail, plus pool counts split by status and
 * by source so the operator can spot at a glance whether the cron is
 * still firing without triggering an actual sync (and burning quota).
 *
 * Requires the admin token (see requireAdminToken above).
 */
router.get("/sync-status", async (req, res) => {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      [{ lastSyncedAt }],
      [{ total }],
      byStatusRows,
      bySourceRows,
      [{ addedLast24h }],
      [{ syncedLast24h }],
      poolResult,
    ] = await Promise.all([
      db
        .select({ lastSyncedAt: sql<Date | null>`MAX(${thumbnailsTable.lastSyncedAt})` })
        .from(thumbnailsTable),
      db.select({ total: count() }).from(thumbnailsTable),
      db
        .select({ status: thumbnailsTable.status, n: count() })
        .from(thumbnailsTable)
        .groupBy(thumbnailsTable.status),
      db
        .select({ source: thumbnailsTable.source, n: count() })
        .from(thumbnailsTable)
        .groupBy(thumbnailsTable.source),
      db
        .select({ addedLast24h: count() })
        .from(thumbnailsTable)
        .where(gte(thumbnailsTable.createdAt, dayAgo)),
      db
        .select({ syncedLast24h: count() })
        .from(thumbnailsTable)
        .where(gte(thumbnailsTable.lastSyncedAt, dayAgo)),
      // One query, six counts. Mirrors exactly what
      // /api/thumbnails(/battle) WHERE clauses use, so "battlePool"
      // here equals the row count returned by the public list endpoint.
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND archived = FALSE
              AND (duration_sec IS NULL OR duration_sec > 180)
          )::int AS battle_pool,
          COUNT(*) FILTER (WHERE archived = TRUE)::int AS archived,
          COUNT(*) FILTER (
            WHERE archived = TRUE
              AND duration_sec IS NOT NULL
              AND duration_sec <= 180
          )::int AS shorts_archived,
          COUNT(*) FILTER (
            WHERE source = 'youtube' AND duration_sec IS NOT NULL
          )::int AS yt_with_duration,
          COUNT(*) FILTER (
            WHERE source = 'youtube' AND duration_sec IS NULL
          )::int AS yt_missing_duration,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND archived = FALSE
              AND duration_sec IS NOT NULL
              AND duration_sec <= 180
          )::int AS shorts_leaked
        FROM thumbnails
      `),
    ]);

    const hoursSinceLastSync = lastSyncedAt
      ? Math.round(((Date.now() - new Date(lastSyncedAt).getTime()) / 3_600_000) * 10) / 10
      : null;

    const pool = (poolResult.rows[0] as
      | {
          battle_pool: number;
          archived: number;
          shorts_archived: number;
          yt_with_duration: number;
          yt_missing_duration: number;
          shorts_leaked: number;
        }
      | undefined) ?? {
      battle_pool: 0,
      archived: 0,
      shorts_archived: 0,
      yt_with_duration: 0,
      yt_missing_duration: 0,
      shorts_leaked: 0,
    };

    return res.json({
      ok: true,
      lastSyncedAt: lastSyncedAt ?? null,
      hoursSinceLastSync,
      counts: {
        total: Number(total),
        byStatus: Object.fromEntries(byStatusRows.map((r) => [r.status, Number(r.n)])),
        bySource: Object.fromEntries(bySourceRows.map((r) => [r.source, Number(r.n)])),
      },
      pool: {
        battlePool: Number(pool.battle_pool),
        archived: Number(pool.archived),
        shortsArchived: Number(pool.shorts_archived),
        shortsLeaked: Number(pool.shorts_leaked),
      },
      duration: {
        youtubeWithDuration: Number(pool.yt_with_duration),
        youtubeMissingDuration: Number(pool.yt_missing_duration),
      },
      activity: {
        addedLast24h: Number(addedLast24h),
        syncedLast24h: Number(syncedLast24h),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get sync status");
    return res.status(500).json({ error: "sync_status_failed" });
  }
});

export default router;
