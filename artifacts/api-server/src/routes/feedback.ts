import { Router } from "express";
import { db, feedbackTable } from "@workspace/db";
import { SubmitFeedbackBody } from "@workspace/api-zod";

const router = Router();

// POST /api/feedback — record beta feedback
router.post("/", async (req, res) => {
  const parsed = SubmitFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid feedback" });
  }

  const { message, email, pageUrl } = parsed.data;
  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) {
    return res.status(400).json({ error: "Message must not be empty" });
  }
  const userAgent = req.get("user-agent") ?? null;

  try {
    const [row] = await db
      .insert(feedbackTable)
      .values({
        message: trimmedMessage,
        email: email ?? null,
        pageUrl: pageUrl ?? null,
        userAgent,
      })
      .returning();

    req.log.info(
      { feedbackId: row.id, hasEmail: !!email, pageUrl },
      "Beta feedback submitted",
    );

    return res.status(201).json({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to record feedback");
    return res.status(500).json({ error: "Failed to record feedback" });
  }
});

export default router;
