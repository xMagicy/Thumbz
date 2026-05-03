import { syncTrendingVideos, archiveUnderperformers } from "./youtube";
import { logger } from "./logger";

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

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 30 * 1000;
const ARCHIVE_BOOT_DELAY_MS = 5 * 60 * 1000;

let syncTimer: NodeJS.Timeout | null = null;
let syncBootTimer: NodeJS.Timeout | null = null;
let archiveTimer: NodeJS.Timeout | null = null;
let archiveBootTimer: NodeJS.Timeout | null = null;

async function runYoutubeSync() {
  try {
    // Use defaults baked into syncTrendingVideos (12 regions, all targeted
    // searches). The scheduler intentionally passes no opts so the sync
    // configuration lives in one place.
    const result = await syncTrendingVideos();
    if (!result.ok && result.reason === "missing_api_key") {
      // Already logged inside syncTrendingVideos.
      return;
    }
    logger.info(
      {
        candidates: result.totalCandidates,
        accepted: result.totalAccepted,
        archivedByBalance: result.totalArchivedByBalance,
      },
      "Scheduled YouTube sync completed",
    );
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

export function startScheduler() {
  if (syncTimer || syncBootTimer || archiveTimer || archiveBootTimer) {
    logger.warn("Scheduler already started — ignoring duplicate start call");
    return;
  }
  syncBootTimer = setTimeout(() => {
    void runYoutubeSync();
  }, BOOT_DELAY_MS);
  syncTimer = setInterval(() => {
    void runYoutubeSync();
  }, SIX_HOURS_MS);

  archiveBootTimer = setTimeout(() => {
    void runArchiveSweep();
  }, ARCHIVE_BOOT_DELAY_MS);
  archiveTimer = setInterval(() => {
    void runArchiveSweep();
  }, DAY_MS);

  logger.info(
    {
      syncIntervalMs: SIX_HOURS_MS,
      archiveIntervalMs: DAY_MS,
      bootDelayMs: BOOT_DELAY_MS,
    },
    "Background scheduler started",
  );
}
