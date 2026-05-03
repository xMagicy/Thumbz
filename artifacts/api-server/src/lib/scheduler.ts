import { syncTrendingVideos, archiveUnderperformers } from "./youtube";
import { logger } from "./logger";
import { withSyncLock } from "./syncLock";
import { db, viewSnapshotsTable, ratingHistoryTable } from "@workspace/db";
import { lt } from "drizzle-orm";

/**
 * Background scheduler for periodic jobs.
 *
 * Currently runs:
 *  - YouTube trending sync every 6 hours (4× per day, 12 regions + targeted
 *    search calls + channels.list enrichment, ~430 quota units per run).
 *  - Daily underperformer archive (Blok D): archives YouTube thumbnails
 *    with elo<1100 AND battle_count>=20.
 *
 * Boot behavior: kicks an initial sync ~30s after server start (gives the DB
 * pool time to warm up). After that, runs on a fixed interval. The archive
 * job has its own daily timer, kicked off ~5min after boot.
 *
 * Both jobs are silent and safe when YOUTUBE_API_KEY is missing — sync
 * short-circuits, archive doesn't depend on the API at all.
 */

// Ronde 3 Blok 3: tightened from 6h → 3h for trend responsiveness.
// Quota budget at 3h: 12 regions × 8 runs/day × ~430 units = ~3500/day,
// well under the 10k daily quota.
//
// claude/backend-fix-1 follow-up #2: relaxed back to 6h. Sourcing
// expanded from 13 → 26 search queries (~2670 quota/run). At 8 runs/day
// we'd burn 21k/day — quadruple the cap. At 4 runs/day = 10,680/day,
// just over the 10k limit. With 6h interval and 5 trending queries
// (down from 12) the realistic daily cost is closer to 9k. Pool grows
// fast enough for the 200-500 target on this cadence: each sync brings
// ~150 new rows, so 2-3 syncs hits the goal.
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 30 * 1000;
const ARCHIVE_BOOT_DELAY_MS = 5 * 60 * 1000;
const RETENTION_BOOT_DELAY_MS = 10 * 60 * 1000;

// Retention windows. view_snapshots is denser (one row per video per
// sync × 4 syncs/day) so we keep less; rating_history grows with battle
// volume which is bounded by user activity, so we keep a longer window
// for trend visualisations.
const VIEW_SNAPSHOT_RETENTION_MS = 30 * DAY_MS;
const RATING_HISTORY_RETENTION_MS = 90 * DAY_MS;

let syncTimer: NodeJS.Timeout | null = null;
let syncBootTimer: NodeJS.Timeout | null = null;
let archiveTimer: NodeJS.Timeout | null = null;
let archiveBootTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;
let retentionBootTimer: NodeJS.Timeout | null = null;

async function runYoutubeSync() {
  // The whole body is wrapped in try/catch because this function is
  // invoked via `void runYoutubeSync()` from setTimeout/setInterval —
  // any uncaught rejection would surface as an unhandledRejection event
  // with no log context. withSyncLock propagates exceptions from
  // syncTrendingVideos, so the catch must sit on the outside of the
  // lock acquisition, not inside.
  try {
    // withSyncLock prevents the scheduler and the manual
    // /admin/sync-youtube route from racing each other (both call
    // syncTrendingVideos and would otherwise duplicate-write
    // view_snapshots and corrupt the per-channel / region / category
    // balance heuristics).
    const locked = await withSyncLock(async () => {
      // Use defaults baked into syncTrendingVideos (12 regions, all targeted
      // searches). The scheduler intentionally passes no opts so the sync
      // configuration lives in one place.
      return syncTrendingVideos();
    });
    if (!locked.ok) {
      logger.warn(
        { reason: locked.reason },
        "Scheduled YouTube sync skipped — another run is in flight",
      );
      return;
    }
    const result = locked.result;
    if (!result.ok && result.reason === "missing_api_key") {
      // Already logged inside syncTrendingVideos.
      return;
    }
    if (result.ok) {
      logger.info(
        {
          candidates: result.totalCandidates,
          accepted: result.totalAccepted,
          archivedByBalance: result.totalArchivedByBalance,
        },
        "Scheduled YouTube sync completed",
      );
    }
  } catch (err) {
    logger.error({ err }, "Scheduled YouTube sync threw");
  }
}

async function runArchiveSweep() {
  try {
    const archived = await archiveUnderperformers();
    logger.info({ archived }, "Daily underperformer archive completed");
  } catch (err) {
    logger.error({ err }, "Daily underperformer archive threw");
  }
}

async function runRetentionSweep() {
  // Keep both tables bounded. Both are append-only, so a daily DELETE
  // by `created_at` / `captured_at` cutoff is enough — no fancy
  // partitioning required at our row-counts.
  try {
    const now = Date.now();
    const snapshotCutoff = new Date(now - VIEW_SNAPSHOT_RETENTION_MS);
    const ratingCutoff = new Date(now - RATING_HISTORY_RETENTION_MS);

    const deletedSnapshots = await db
      .delete(viewSnapshotsTable)
      .where(lt(viewSnapshotsTable.capturedAt, snapshotCutoff))
      .returning({ id: viewSnapshotsTable.id });

    const deletedRatings = await db
      .delete(ratingHistoryTable)
      .where(lt(ratingHistoryTable.createdAt, ratingCutoff))
      .returning({ id: ratingHistoryTable.id });

    logger.info(
      {
        viewSnapshots: deletedSnapshots.length,
        ratingHistory: deletedRatings.length,
        snapshotCutoff: snapshotCutoff.toISOString(),
        ratingCutoff: ratingCutoff.toISOString(),
      },
      "Daily retention sweep completed",
    );
  } catch (err) {
    logger.error({ err }, "Daily retention sweep threw");
  }
}

export function startScheduler() {
  if (
    syncTimer ||
    syncBootTimer ||
    archiveTimer ||
    archiveBootTimer ||
    retentionTimer ||
    retentionBootTimer
  ) {
    logger.warn("Scheduler already started — ignoring duplicate start call");
    return;
  }
  syncBootTimer = setTimeout(() => {
    void runYoutubeSync();
  }, BOOT_DELAY_MS);
  syncTimer = setInterval(() => {
    void runYoutubeSync();
  }, SYNC_INTERVAL_MS);

  archiveBootTimer = setTimeout(() => {
    void runArchiveSweep();
  }, ARCHIVE_BOOT_DELAY_MS);
  archiveTimer = setInterval(() => {
    void runArchiveSweep();
  }, DAY_MS);

  // Retention sweep runs daily, offset 10min from boot so it doesn't
  // race the first archive pass. Both jobs are idempotent so order
  // doesn't actually matter, but staggering keeps the log readable.
  retentionBootTimer = setTimeout(() => {
    void runRetentionSweep();
  }, RETENTION_BOOT_DELAY_MS);
  retentionTimer = setInterval(() => {
    void runRetentionSweep();
  }, DAY_MS);

  logger.info(
    {
      syncIntervalMs: SYNC_INTERVAL_MS,
      archiveIntervalMs: DAY_MS,
      retentionIntervalMs: DAY_MS,
      bootDelayMs: BOOT_DELAY_MS,
    },
    "Background scheduler started",
  );
}
