import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { thumbnailsTable } from "./thumbnails";

export const battlesTable = pgTable("battles", {
  id: serial("id").primaryKey(),
  winnerId: integer("winner_id").notNull().references(() => thumbnailsTable.id),
  loserId: integer("loser_id").notNull().references(() => thumbnailsTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBattleSchema = createInsertSchema(battlesTable).omit({ id: true, createdAt: true });
export type InsertBattle = z.infer<typeof insertBattleSchema>;
export type Battle = typeof battlesTable.$inferSelect;
