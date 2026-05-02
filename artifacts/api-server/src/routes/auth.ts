import { Router } from "express";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { db, usersTable } from "@workspace/db";
import { setSession, clearSession, getUserIdFromSession } from "../lib/sessions";

const router = Router();

const CLIENT_ID = process.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
if (!CLIENT_ID) {
  throw new Error(
    "VITE_GOOGLE_OAUTH_CLIENT_ID must be set for the auth routes to function",
  );
}

const googleClient = new OAuth2Client(CLIENT_ID);

// POST /api/auth/google — verify Google ID token, find-or-create user, set session
router.post("/google", async (req, res) => {
  const idToken = (req.body as { idToken?: unknown } | undefined)?.idToken;
  if (typeof idToken !== "string" || idToken.length < 10) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      return res.status(401).json({ error: "Invalid Google token" });
    }

    const googleSub = payload.sub;
    const email = payload.email;
    const name = payload.name ?? null;
    const avatarUrl = payload.picture ?? null;

    // Upsert by googleSub. Email/name/avatar refresh on every login so a renamed
    // Google account stays in sync with us automatically.
    const [user] = await db
      .insert(usersTable)
      .values({ googleSub, email, name, avatarUrl })
      .onConflictDoUpdate({
        target: usersTable.googleSub,
        set: { email, name, avatarUrl },
      })
      .returning();

    setSession(res, user.id);
    req.log.info({ userId: user.id }, "User signed in via Google");

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Google sign-in failed");
    return res.status(401).json({ error: "Authentication failed" });
  }
});

// POST /api/auth/logout — clear the session cookie
router.post("/logout", (_req, res) => {
  clearSession(res);
  return res.status(204).end();
});

// GET /api/auth/me — return the current user, or null when no session
router.get("/me", async (req, res) => {
  const userId = getUserIdFromSession(req);
  if (!userId) {
    return res.status(200).json({ user: null });
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      // Cookie points to a user that no longer exists. Clear it so the client
      // does not loop on a stale identity.
      clearSession(res);
      return res.status(200).json({ user: null });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    req.log.error({ err, userId }, "Failed to fetch current user");
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
