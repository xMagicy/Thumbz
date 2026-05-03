import { Router, type Request, type Response, type NextFunction } from "express";
import { syncTrendingVideos } from "../lib/youtube";

const router: Router = Router();

/**
 * Admin token gate.
 *
 * Requires header `Authorization: Bearer <ADMIN_TOKEN>` matching the
 * ADMIN_TOKEN env secret. If ADMIN_TOKEN is not configured, the entire
 * /admin namespace is locked (503) — fail-closed by default so an
 * unset secret can never accidentally expose privileged operations.
 *
 * This is intentionally simple (single shared token) because /admin is
 * for operator use, not multi-user. When we need real role-based
 * access, swap in the Better Auth session + isAdmin flag.
 */
function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env["ADMIN_TOKEN"];
  if (!expected) {
    return res.status(503).json({
      error: "admin_disabled",
      message: "ADMIN_TOKEN is not configured on the server.",
    });
  }
  const header = req.headers["authorization"];
  const token =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : null;
  if (!token || token !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

router.use(requireAdminToken);

/**
 * POST /api/admin/sync-youtube
 *
 * Manually trigger a YouTube trending sync. Useful for testing right
 * after adding the YOUTUBE_API_KEY without waiting for the 6h cron.
 *
 * Requires the admin token (see requireAdminToken above).
 */
router.post("/sync-youtube", async (req, res) => {
  try {
    const regions =
      typeof req.query["regions"] === "string"
        ? req.query["regions"].split(",").map((s) => s.trim())
        : undefined;
    const maxResults =
      typeof req.query["max"] === "string"
        ? Number(req.query["max"])
        : undefined;

    const result = await syncTrendingVideos({ regions, maxResults });
    if (!result.ok) {
      return res.status(503).json({
        error: "sync_unavailable",
        reason: result.reason,
        message:
          result.reason === "missing_api_key"
            ? "YOUTUBE_API_KEY is not configured."
            : "YouTube sync is unavailable.",
      });
    }
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Manual YouTube sync failed");
    return res.status(500).json({ error: "sync_failed" });
  }
});

export default router;
