import { pgTable, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { thumbnailsTable } from "./thumbnails";

export const battlesTable = pgTable(
  "battles",
  {
    id: serial("id").primaryKey(),
    winnerId: integer("winner_id").notNull().references(() => thumbnailsTable.id),
    loserId: integer("loser_id").notNull().references(() => thumbnailsTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Leaderboard / battle-history queries pull recent rows for a given
    // thumbnail by winnerId or loserId ordered by createdAt DESC. Without
    // these composite indexes Postgres has to scan the full table per
    // thumbnail. Both index columns mirror the typical WHERE+ORDER BY.
    index("battles_winner_created_idx").on(t.winnerId, t.createdAt),
    index("battles_loser_created_idx").on(t.loserId, t.createdAt),
  ],
);

export const insertBattleSchema = createInsertSchema(battlesTable).omit({ id: true, createdAt: true });
export type InsertBattle = z.infer<typeof insertBattleSchema>;
export type Battle = typeof battlesTable.$inferSelect;
