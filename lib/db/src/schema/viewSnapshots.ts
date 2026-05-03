import {
  pgTable,
  serial,
  integer,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { thumbnailsTable } from "./thumbnails";

/**
 * Time-series of YouTube view counts per thumbnail.
 *
 * Every YouTube sync captures one row per touched video. We use the
 * delta between the latest two rows to compute viewVelocity (views/hour),
 * which is the core "rising" signal for the homepage.
 *
 * Rows are append-only and intentionally NOT deduped — keeping the full
 * history lets us draw view-trend sparklines later without re-querying
 * YouTube.
 */
export const viewSnapshotsTable = pgTable(
  "view_snapshots",
  {
    id: serial("id").primaryKey(),
    thumbnailId: integer("thumbnail_id")
      .notNull()
      .references(() => thumbnailsTable.id, { onDelete: "cascade" }),
    viewCount: bigint("view_count", { mode: "number" }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("view_snapshots_thumbnail_captured_idx").on(
      t.thumbnailId,
      t.capturedAt,
    ),
  ],
);

export type ViewSnapshot = typeof viewSnapshotsTable.$inferSelect;
