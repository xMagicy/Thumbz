import { pgTable, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { thumbnailsTable } from "./thumbnails";

export const ratingHistoryTable = pgTable(
  "rating_history",
  {
    id: serial("id").primaryKey(),
    thumbnailId: integer("thumbnail_id")
      .notNull()
      .references(() => thumbnailsTable.id),
    rating: integer("rating").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rating_history_thumb_created_idx").on(t.thumbnailId, t.createdAt)],
);

export type RatingHistory = typeof ratingHistoryTable.$inferSelect;
