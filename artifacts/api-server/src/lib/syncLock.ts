/**
 * In-memory mutex for the YouTube sync.
 *
 * Both the 6-hour cron and the manual POST /api/admin/sync-youtube call
 * the same syncTrendingVideos() function. A single sync run takes ~30s
 * (12 regions + targeted searches + channels.list enrichment), so two
 * concurrent runs are realistic in practice — operator triggers a manual
 * sync just as the cron fires, or hits the admin endpoint twice in
 * frustration when the first response is slow.
 *
 * The data hazards are real: both runs would do the same upserts, both
 * would write view_snapshots for the same fetched videos at the same
 * timestamp, and the per-channel cap / region balance / category balance
 * heuristics would each see only their own slice — leaving the pool in
 * a state neither run intended.
 *
 * One Node process owns the scheduler today, so an in-memory boolean is
 * sufficient. If/when we ever scale the API to multiple replicas this
 * needs to become a Postgres advisory lock (`SELECT pg_try_advisory_lock`).
 *
 * `withSyncLock` returns the inner result on success, or `{ ok: false,
 * reason: "already_running" }` if the lock is already held.
 */

let isRunning = false;

export type SyncLockResult<T> =
  | { ok: true; result: T }
  | { ok: false; reason: "already_running" };

export async function withSyncLock<T>(
  fn: () => Promise<T>,
): Promise<SyncLockResult<T>> {
  if (isRunning) {
    return { ok: false, reason: "already_running" };
  }
  isRunning = true;
  try {
    const result = await fn();
    return { ok: true, result };
  } finally {
    isRunning = false;
  }
}

export function isSyncRunning(): boolean {
  return isRunning;
}
