import { pgTable, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { thumbnailsTable } from "./thumbnails";

// Records each thumbnail's ELO rating after every vote it participates in.
// Powers the per-thumbnail history sparkline on the user dashboard. One row
// per thumbnail per vote — written by the vote endpoint after ELO is updated.
export const eloHistoryTable = pgTable(
  "elo_history",
  {
    id: serial("id").primaryKey(),
    thumbnailId: integer("thumbnail_id")
      .notNull()
      .references(() => thumbnailsTable.id, { onDelete: "cascade" }),
    eloRating: integer("elo_rating").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("elo_history_thumbnail_id_recorded_at_idx").on(
      table.thumbnailId,
      table.recordedAt,
    ),
  ],
);

export type EloHistoryEntry = typeof eloHistoryTable.$inferSelect;
