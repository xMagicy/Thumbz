import type { Request, Response, CookieOptions } from "express";

const COOKIE_NAME = "thumbz_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_MS,
    signed: true,
    path: "/",
  };
}

export function setSession(res: Response, userId: number): void {
  res.cookie(COOKIE_NAME, String(userId), cookieOptions());
}

export function clearSession(res: Response): void {
  // Browsers only clear a cookie when the path/secure/sameSite attributes match
  // what was set. Mirror the original options minus maxAge.
  const opts = cookieOptions();
  delete (opts as Partial<CookieOptions>).maxAge;
  res.clearCookie(COOKIE_NAME, opts);
}

export function getUserIdFromSession(req: Request): number | null {
  const raw = req.signedCookies?.[COOKIE_NAME];
  if (typeof raw !== "string") return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}
