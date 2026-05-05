import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  real,
  boolean,
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
    // YouTube channelId (e.g. "UCX6OQ3DkcsbYNE6H8uQQuVA"). Stored so the
    // logo backfill + future channel-grouping queries don't have to
    // re-resolve it from the videoId. NULL for user uploads.
    channelId: text("channel_id"),
    // Cached channel avatar URL — snippet.thumbnails.medium.url from
    // channels.list. Rendered in FighterCard / Leaderboard / dashboard.
    // NULL for user uploads (UI falls back to a gradient initial).
    channelLogoUrl: text("channel_logo_url"),
    // Legacy upload-input field. Captures what the uploader picked at
    // upload time (and what early seed/YouTube rows were tagged with).
    // Post task #16 backfill, `app_category` below is the single source of
    // truth for matchmaking and leaderboard filtering — do not query on
    // `niche` directly. New uploads mirror this into `app_category` on
    // insert so both stay in sync at write time.
    niche: text("niche").notNull().default("Other"),
    ctr: real("ctr"),
    youtubeUrl: text("youtube_url"),
    status: text("status").notNull().default("active"),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    // Default 1200 for new rows (per Blok B brief). Existing rows keep
    // whatever ELO score the vote pipeline gave them — we never reset live
    // ratings, that would destroy real measurement data.
    eloRating: integer("elo_rating").notNull().default(1200),
    // Total battles this thumbnail has been in (winner OR loser side).
    // Maintained explicitly in the vote handler so the K-factor schedule
    // can decay (K=32 while <20, then K=16) without recomputing from
    // wins+losses every request.
    battleCount: integer("battle_count").notNull().default(0),
    // Soft-delete flag. Archived thumbnails are excluded from battle
    // pairing and the leaderboard, but kept around for analytics. The
    // daily curation cron sets this for chronic underperformers
    // (elo<1100 AND battle_count>=20).
    archived: boolean("archived").notNull().default(false),
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
    // Video duration in seconds. Persisted so the query-time Shorts
    // gate can reject rows with `duration_sec <= 180` without re-calling
    // the YouTube API on every battle pair request. NULL on legacy rows
    // until the recheckShortsViaApi backfill populates them; once
    // populated, sync upserts and recheck both keep this fresh.
    durationSec: integer("duration_sec"),

    // ── Sourcing v2 (Blok A) ───────────────────────────────────────────
    // Raw YouTube category id (1, 10, 20, ...). We keep the int so we
    // can do category-locked matchmaking even when our niche mapping
    // changes. NULL for user uploads.
    categoryId: integer("category_id"),
    // Cached channel subscriber count from channels.list at sync time.
    // Drives the overperformer ratio (viewCount / subscriberCount) which
    // is the KERN signal for surfacing breakout videos from small
    // channels — exactly the case where the thumbnail does the work.
    subscriberCount: integer("subscriber_count"),
    // Cached overperformer ratio. Stored so we can sort/filter without
    // re-dividing on every query.
    viewToSubRatio: real("view_to_sub_ratio"),
    // Region codes where this video appeared in mostPopular during the
    // last sync. Multi-region presence = strong global signal. Stored
    // as a Postgres text[] so we can `unnest` for the balance query.
    trendingRegions: text("trending_regions").array(),
    // ── Blok E hybrid classifier output ────────────────────────────────
    // Final UI-facing category produced by the hybrid classifier
    // (categoryId + title keywords + channel patterns). Distinct from
    // YouTube's raw categoryId because one categoryId can map to several
    // niches (e.g. categoryId=22 People&Blogs → could be Lifestyle, Vlog,
    // or Finance depending on title). Matchmaking and leaderboard tabs
    // both read this — it is the single source of truth for category
    // filtering (see replit.md "Category model"). User uploads mirror
    // their picked `niche` into this column on insert; legacy NULL rows
    // were backfilled from `niche` in task #16. Still nullable in the
    // schema as a safety net, but list/battle queries assume populated.
    appCategory: text("app_category"),

    // ── Blok G velocity + emerging channel signals ─────────────────────
    // Cached views/hour computed at sync time:
    //   views_per_hour = view_count / hours_since_publish
    // Used both as a quality filter (>=500 vph baseline) and as a
    // velocity input to breakout_score. Stored so the leaderboard "rising"
    // sort doesn't need to recompute on every read.
    viewsPerHour: real("views_per_hour"),
    // When the *channel* (not the video) was created. From channels.list
    // snippet.publishedAt. Lets us flag fresh creators where a single
    // breakout video is real signal, not noise.
    channelCreatedAt: timestamp("channel_created_at", { withTimezone: true }),
    // Cached channel age in days at sync time.
    channelAgeDays: integer("channel_age_days"),
    // Convenience flag: channel age < 180 days. Drives the future
    // "Discover" tab and acts as a small bonus in breakout_score.
    isEmergingChannel: boolean("is_emerging_channel").notNull().default(false),
    // Composite ranking signal (Blok G):
    //   30·log10(vph)
    // + 40·log10(viewToSubRatio + 1)
    // + 20 if emerging
    // + 10·(engagement_rate * 100)
    // Used as a tiebreaker in matchmaking and as the future Discover sort.
    breakoutScore: real("breakout_score"),
  },
  (t) => [
    index("thumbnails_user_id_idx").on(t.userId),
    uniqueIndex("thumbnails_youtube_video_id_uq").on(t.youtubeVideoId),
    index("thumbnails_source_idx").on(t.source),
    index("thumbnails_view_velocity_idx").on(t.viewVelocity),
    index("thumbnails_archived_idx").on(t.archived),
    index("thumbnails_elo_idx").on(t.eloRating),
    index("thumbnails_duration_sec_idx").on(t.durationSec),
  ],
);

export const insertThumbnailSchema = createInsertSchema(thumbnailsTable).omit({
  id: true,
});
export type InsertThumbnail = z.infer<typeof insertThumbnailSchema>;
export type Thumbnail = typeof thumbnailsTable.$inferSelect;
