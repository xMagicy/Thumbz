import { Router } from "express";
import { syncTrendingVideos } from "../lib/youtube";

const router: Router = Router();

/**
 * POST /api/admin/sync-youtube
 *
 * Manually trigger a YouTube trending sync. Useful for testing right
 * after adding the YOUTUBE_API_KEY without waiting for the 6h cron.
 *
 * NOTE: This is currently unauthenticated. Before exposing publicly,
 * gate behind an admin role check (Better Auth session + isAdmin flag).
 * For now it's safe-ish because the worst it can do is spend YouTube
 * quota — no destructive operations.
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
