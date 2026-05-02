import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const waitlistTable = pgTable(
  "waitlist",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    signedUpAt: timestamp("signed_up_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUniqueIdx: uniqueIndex("waitlist_email_unique_idx").on(t.email),
  }),
);

export const insertWaitlistSchema = createInsertSchema(waitlistTable).omit({
  id: true,
  signedUpAt: true,
});
export type InsertWaitlist = z.infer<typeof insertWaitlistSchema>;
export type WaitlistEntry = typeof waitlistTable.$inferSelect;
