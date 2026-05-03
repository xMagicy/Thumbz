import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  real,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { userTable } from "./auth";

export const thumbnailsTable = pgTable(
  "thumbnails",
  {
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Nullable so legacy seed thumbnails (and anonymous uploads) keep working.
    // FK to better-auth user table; SET NULL on delete so deleting a user
    // doesn't nuke their uploaded thumbnails.
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),

    // ── Phase B: provenance & YouTube sync ─────────────────────────────
    // Where this thumbnail came from. "user" = uploaded via /upload,
    // "youtube" = pulled via Trending sync, "seed" = original demo data.
    source: text("source").notNull().default("user"),
    // YouTube videoId (e.g. "dQw4w9WgXcQ"). Unique when present so the
    // sync job can upsert without duplicating the same video. NULL for
    // user uploads.
    youtubeVideoId: text("youtube_video_id"),
    // Snapshot of the video's view count at lastSyncedAt. Stored as
    // bigint because popular videos easily exceed 2^31.
    viewCount: bigint("view_count", { mode: "number" }),
    // Views-per-hour velocity computed by comparing the last two
    // snapshots in viewSnapshots. NULL until we have ≥2 snapshots.
    // This is the "rising" signal — sort by this DESC to see what's
    // exploding right now.
    viewVelocity: real("view_velocity"),
    // When the YouTube video was originally published. Used to compute
    // age-relative metrics ("100k views in 2h" = much hotter than
    // "100k views in 2 weeks").
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Last time the YouTube sync touched this row.
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    index("thumbnails_user_id_idx").on(t.userId),
    uniqueIndex("thumbnails_youtube_video_id_uq").on(t.youtubeVideoId),
    index("thumbnails_source_idx").on(t.source),
    index("thumbnails_view_velocity_idx").on(t.viewVelocity),
  ],
);

export const insertThumbnailSchema = createInsertSchema(thumbnailsTable).omit({
  id: true,
});
export type InsertThumbnail = z.infer<typeof insertThumbnailSchema>;
export type Thumbnail = typeof thumbnailsTable.$inferSelect;
