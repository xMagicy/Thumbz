import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, waitlistTable } from "@workspace/db";
import { JoinWaitlistBody } from "@workspace/api-zod";

const router = Router();

// Loose RFC-2822-ish check; the OpenAPI schema also enforces format=email + length.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/waitlist — capture an email for the upload-feature waitlist.
// Idempotent: if the email already exists we return the existing row instead of
// erroring out (the user just gets "you're on the list" again, no spammable DB rows).
router.post("/", async (req, res) => {
  const parsed = JoinWaitlistBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email" });
  }

  const email = parsed.data.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Invalid email" });
  }

  try {
    // Try to insert; on email-unique conflict, do nothing and fall through to
    // a SELECT so we always return the row that represents this user's signup.
    const inserted = await db
      .insert(waitlistTable)
      .values({ email })
      .onConflictDoNothing({ target: waitlistTable.email })
      .returning();

    let row = inserted[0];
    if (!row) {
      const existing = await db
        .select()
        .from(waitlistTable)
        .where(eq(waitlistTable.email, email))
        .limit(1);
      row = existing[0];
    }

    if (!row) {
      // Should be unreachable — insert + select both empty means a deeper DB issue.
      throw new Error("Waitlist row neither inserted nor found after conflict");
    }

    req.log.info({ waitlistId: row.id, isNew: inserted.length > 0 }, "Waitlist signup");

    return res.status(201).json({
      id: row.id,
      signedUpAt: row.signedUpAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to record waitlist signup");
    return res.status(500).json({ error: "Failed to record signup" });
  }
});

export default router;
