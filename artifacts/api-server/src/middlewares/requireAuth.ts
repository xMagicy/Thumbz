import type { Request, Response, NextFunction } from "express";
import { auth } from "../lib/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
      };
    }
  }
}

function toFetchHeaders(nodeHeaders: Request["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (typeof value === "string") headers.set(key, value);
  }
  return headers;
}

// Express middleware that gates a route on a valid Better Auth session.
// On success: attaches the user to req.user and calls next().
// On failure: 401 JSON. The route handler is never invoked.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({
      headers: toFetchHeaders(req.headers),
    });
    if (!session?.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
    return next();
  } catch (err) {
    req.log.error({ err }, "Failed to resolve auth session");
    return res.status(500).json({ error: "Failed to resolve session" });
  }
}
