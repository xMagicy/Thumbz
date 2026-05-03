import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { userTable } from "./auth";

export const thumbnailsTable = pgTable("thumbnails", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  imageUrl: text("image_url").notNull(),
  channelName: text("channel_name").notNull(),
  niche: text("niche").notNull().default("Other"),
  ctr: real("ctr"),
  youtubeUrl: text("youtube_url"),
  status: text("status").notNull().default("active"),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  eloRating: integer("elo_rating").notNull().default(1000),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Nullable on purpose: existing seed thumbnails (pre-auth) stay NULL and
  // represent "system" rows. Only user-uploaded thumbnails carry a userId.
  // ON DELETE SET NULL: when a user deletes their account their thumbnails
  // remain in the battle pool (orphaned but visible).
  userId: text("user_id").references(() => userTable.id, { onDelete: "set null" }),
});

export const insertThumbnailSchema = createInsertSchema(thumbnailsTable).omit({ id: true });
export type InsertThumbnail = z.infer<typeof insertThumbnailSchema>;
export type Thumbnail = typeof thumbnailsTable.$inferSelect;
