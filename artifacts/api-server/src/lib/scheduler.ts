import { syncTrendingVideos, archiveUnderperformers } from "./youtube";
import { logger } from "./logger";

/**
 * Background scheduler for periodic jobs.
 *
 * Currently runs:
 *  - YouTube trending sync every 6 hours (4× per day).
 *
 * The scheduler is silent and safe when YOUTUBE_API_KEY is missing —
 * the sync function itself short-circuits, so no error spam.
 *
 * Boot behavior: kicks an initial sync ~30s after server start (gives
 * the DB pool time to warm up). After that, runs on a fixed interval.
 */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 30 * 1000;

let timer: NodeJS.Timeout | null = null;
let bootTimer: NodeJS.Timeout | null = null;

async function runYoutubeSync() {
  try {
    const result = await syncTrendingVideos({
      // 12 regions × 50 results × 4 syncs/day = 2400 quota units/day,
      // well under YouTube's 10k/day free tier.
      regions: [
        "US", "GB", "CA", "AU", "DE", "FR",
        "NL", "BR", "MX", "JP", "KR", "IN",
      ],
      maxResults: 50,
    });
    if (!result.ok && result.reason === "missing_api_key") {
      // Already logged inside syncTrendingVideos.
      return;
    }
    logger.info(
      { results: result.results },
      "Scheduled YouTube sync completed",
    );
  } catch (err) {
    logger.error({ err }, "Scheduled YouTube sync threw");
  }
}

export function startScheduler() {
  if (timer || bootTimer) {
    logger.warn("Scheduler already started — ignoring duplicate start call");
    return;
  }
  bootTimer = setTimeout(() => {
    void runYoutubeSync();
  }, BOOT_DELAY_MS);
  timer = setInterval(() => {
    void runYoutubeSync();
  }, SIX_HOURS_MS);
  logger.info(
    { intervalMs: SIX_HOURS_MS, bootDelayMs: BOOT_DELAY_MS },
    "Background scheduler started",
  );
}
