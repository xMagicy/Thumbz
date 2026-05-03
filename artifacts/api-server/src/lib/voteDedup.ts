/**
 * Anti-spam dedupe for POST /api/battles/vote.
 *
 * Hash each (clientKey, pairKey) — where clientKey is the auth user id
 * if logged in, otherwise the request IP — into a Map keyed at second
 * granularity. If we see the same pair from the same client within
 * DEDUP_WINDOW_MS the vote is rejected with 429.
 *
 * pairKey is order-insensitive: `${min(a,b)}:${max(a,b)}`. A user
 * shouldn't be able to bypass dedup by swapping which side they
 * "won" — the audit framed this as anti-spam, not anti-revote.
 *
 * In-memory only. We're a single Node process today; if/when we
 * horizontally scale the API this should move to Redis. The map is
 * swept opportunistically on each call (cheap because typical entry
 * count is in the hundreds).
 */

const DEDUP_WINDOW_MS = 5_000;

type Entry = { expiresAt: number };

const seen = new Map<string, Entry>();

function sweep(now: number): void {
  // Bound work per call: only iterate when the map gets noticeably
  // large. Sweep removes expired entries in-place.
  if (seen.size < 256) return;
  for (const [k, v] of seen) {
    if (v.expiresAt <= now) seen.delete(k);
  }
}

export function recordVoteOrReject(
  clientKey: string,
  a: number,
  b: number,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  sweep(now);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const key = `${clientKey}::${lo}:${hi}`;
  const existing = seen.get(key);
  if (existing && existing.expiresAt > now) {
    return { ok: false, retryAfterMs: existing.expiresAt - now };
  }
  seen.set(key, { expiresAt: now + DEDUP_WINDOW_MS });
  return { ok: true };
}
