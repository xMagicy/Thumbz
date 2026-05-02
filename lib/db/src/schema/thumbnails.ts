import { pgTable, serial, text, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const thumbnailsTable = pgTable("thumbnails", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  imageUrl: text("image_url").notNull(),
  channelName: text("channel_name").notNull(),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  eloRating: integer("elo_rating").notNull().default(1000),
});

export const insertThumbnailSchema = createInsertSchema(thumbnailsTable).omit({ id: true });
export type InsertThumbnail = z.infer<typeof insertThumbnailSchema>;
export type Thumbnail = typeof thumbnailsTable.$inferSelect;
