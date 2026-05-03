import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Rate limits for write endpoints (Blok H P1 follow-up).
 *
 * - Vote: bursts are normal (a user can plausibly tap through 60 battles
 *   in a minute on mobile). The limit absorbs that without throttling
 *   honest sessions, but rejects scripted abuse.
 * - Upload: comparatively rare, much more expensive (image storage,
 *   moderation cost). Tighter ceiling.
 *
 * Keying: prefer the auth user id when available on the request,
 * otherwise the client IP. Better Auth attaches no req.user by default
 * outside requireAuth-protected routes, so on /vote we read it
 * best-effort and fall back to IP. ipKeyGenerator handles IPv6 /64
 * grouping correctly.
 *
 * Behavior under proxy: app.set("trust proxy", 1) is configured in
 * app.ts so req.ip is the real client (Replit forwards via X-Forwarded-
 * For). Without that, every request would key to the proxy IP and the
 * limiter would fire 429 for everyone in seconds.
 */

/**
 * Canonical client identity used by both the rate limiter and the vote
 * dedupe map. Exported so /vote can produce the exact same key shape
 * as the limiter — otherwise a client could end up rate-limited on one
 * key and deduped on a different one, weakening both layers.
 */
export function clientKey(req: Request): string {
  // Routes guarded by requireAuth attach req.user. Anonymous routes
  // don't, so we fall back to IP. The cast is needed because Express's
  // base Request type doesn't know about our auth augmentation here
  // (requireAuth lives in middlewares/ and only widens its protected
  // routes' Request type).
  const uid = (req as Request & { user?: { id?: string } }).user?.id;
  if (uid) return `u:${uid}`;
  // ipKeyGenerator handles IPv6 /64 grouping correctly; using raw
  // req.ip would let two requests from the same /64 land in different
  // buckets and bypass both the limiter and the dedupe.
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

export const voteRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90, // ≈1.5 votes/sec sustained — comfortable for thumb-spam, hostile to bots.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "rate_limited", message: "Too many votes. Slow down a bit." },
});

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1h
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "rate_limited", message: "Too many uploads in the last hour." },
});
