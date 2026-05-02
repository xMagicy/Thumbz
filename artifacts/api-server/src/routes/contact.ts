import { Router } from "express";
import { db, contactSubmissionsTable } from "@workspace/db";
import { SubmitContactBody } from "@workspace/api-zod";

const router = Router();

router.post("/", async (req, res) => {
  const parsed = SubmitContactBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid contact submission" });
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim();
  const message = parsed.data.message.trim();

  if (name.length === 0 || message.length === 0) {
    return res
      .status(400)
      .json({ error: "Name and message must not be empty" });
  }

  const userAgent = req.get("user-agent") ?? null;

  try {
    const [row] = await db
      .insert(contactSubmissionsTable)
      .values({ name, email, message, userAgent })
      .returning();

    req.log.info(
      { contactId: row.id, email },
      "xMagicy contact submission recorded",
    );

    return res.status(201).json({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to record contact submission");
    return res.status(500).json({ error: "Failed to record submission" });
  }
});

export default router;
