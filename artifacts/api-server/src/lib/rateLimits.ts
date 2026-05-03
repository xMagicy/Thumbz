import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Rate limits for write endpoints (Blok H P1 follow-up).
 *
 * - Vote: bursts are normal (a user can plausibly tap through 60 battles
 *   in a minute on mobile). The limit is set to absorb that without
 *   throttling honest sessions, but reject scripted abuse.
 * - Upload: comparatively rare, much more expensive (image storage,
 *   moderation cost). Tighter ceiling.
 *
 * Keying: prefer the auth user id (forwarded by requireAuth on the
 * upload route — for vote we read it best-effort), fall back to IP. The
 * IPv6-safe ipKeyGenerator from express-rate-limit handles /64 grouping.
 *
 * Behavior under proxy: trust proxy is set on the app entry point so
 * req.ip is the real client. If that ever changes these counters would
 * silently collapse to a single key — visible immediately as 429s for
 * everyone behind the proxy.
 */

function clientKey(req: Parameters<Parameters<typeof rateLimit>[0]["keyGenerator"] & ((req: never, res: never) => string)>[0]): string {
  // Use any auth.user.id the route already attached to req; fall back
  // to a best-effort header sniff (Better Auth cookies aren't decoded
  // here — we keep the IP fallback simple and deterministic).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = req as any;
  const uid: string | undefined = r?.user?.id ?? r?.auth?.userId;
  if (uid) return `u:${uid}`;
  // ipKeyGenerator handles IPv6 grouping safely.
  return `ip:${ipKeyGenerator(r.ip ?? "")}`;
}

export const voteRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90, // ≈1.5 votes/sec sustained — comfortable for thumb-spam, hostile to bots.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyGenerator: clientKey as any,
  message: { error: "rate_limited", message: "Too many votes. Slow down a bit." },
});

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1h
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyGenerator: clientKey as any,
  message: { error: "rate_limited", message: "Too many uploads in the last hour." },
});
