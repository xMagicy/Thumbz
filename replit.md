# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## ThumbBattle Notes

- Site is in beta. The header BETA badge and a "Send feedback" link both
  open a feedback dialog (`FeedbackDialog`) that POSTs to `/api/feedback`.
- Feedback is stored in the `feedback` table (`lib/db/src/schema/feedback.ts`)
  with optional email + page URL + user-agent for context.

### Category model (`niche` vs `app_category`)

- `app_category` is the **single source of truth** for matchmaking and
  leaderboard filtering. All thumbnail rows have it populated (legacy NULLs
  were backfilled from `niche` in task #16).
- `niche` is **legacy upload-input only**: it captures what the uploader
  picked at upload time and what early seed/YouTube rows were tagged with.
  New user uploads mirror it into `app_category` on insert; the YouTube
  classifier writes `app_category` directly. Do not add new query paths
  that filter on `niche` — use `app_category`.

### Bad-content defense in depth (claude/backend-fix-1)

The pool must contain **only** trending creator content. No Shorts, no
movie/TV trailers, no commercial/aggregator channels, no music labels, no
vertically-aspected thumbnails. Three independent enforcement layers:

1. **Sync-time gates** in `lib/youtube.ts > passesPreClassifierFilters`:
   - `EXCLUDED_CATEGORIES`: categoryId 1 (Film) + 10 (Music)
   - `CHANNEL_NAME_BLOCKLIST`: substring brand match (Marvel, Netflix, …)
   - `CHANNEL_NAME_SUFFIX_BLOCKLIST`: ends with Studios|Pictures|…|Entertainment
   - `TRAILER_TITLE_PATTERN` + year-pattern + pipe-cast-list pattern
   - `SHORTS_TEXT_PATTERN` + tag check + duration ≤ 180s
   - `detectVerticalAcrossAllVariants`: ANY thumbnail variant is vertical → reject

2. **DB persistence** of aspect signal: `is_vertical_thumbnail` boolean
   (plus `thumbnail_width`, `thumbnail_height`) — set at sync time across
   all API thumbnail variants, not just maxres → high. Indexed.

3. **Query-time filter** in `routes/thumbnails.ts > BAD_CONTENT_EXCLUSION_SQL`:
   mirrors every sync-time rule as a SQL predicate. Even if the sync layer
   regresses or a row is manually inserted, query-time blocks it from
   appearing in any battle pair, leaderboard, or list endpoint.

EVERY new list/battle endpoint must AND `BAD_CONTENT_EXCLUSION_SQL` into
its WHERE clause. The only legal exception is genuine analytics tooling
("show me everything we blocked") which is not user-facing.

Cleanup of legacy rows (one-shot, idempotent):
`pnpm --filter @workspace/scripts run cleanup-bad-content`

### Sourcing diversity

YouTube `mostPopular` is globally Gaming-Music-heavy. Per-niche targeted
search queries in `TARGETED_SEARCHES` fill underrepresented buckets
(Tech, Vlog, Tutorial, Lifestyle, Finance, Other, Emerging). Each runs
one `search.list` call per sync (~100 quota). When adjusting per-niche
distribution, edit `TARGETED_SEARCHES` rather than `mostPopular` regions.

### Vote-flow architecture (`Home.tsx`)

The vote → animation → next-pair pipeline is built around a **monotonic
`round` counter** as the single UI-unlock signal:

- `voteState = { winnerId, round }` is locked to the round it was cast on.
- `activeVote` is valid only when `voteState.round === round`. Bumping `round`
  atomically deactivates the vote, unlocks the click guard, and forces the
  AnimatePresence container (keyed `r${round}-${pairKey}`) to transition —
  even if the random pair selector returns the same pair twice in a row.
- The round bump fires on a **deterministic 800ms `setTimeout` inside
  `handleVote`**, NOT in `castVote.onSuccess`. This guarantees the UI never
  deadlocks on a failed/slow mutation.
- `castVote.mutate()` runs immediately on click so server work overlaps the
  cinematic animation. `retry: 1` on both the mutation and `useGetBattlePair`
  handles transient failures.
- The early-return guard checks `activeVote !== null` (round-aware), not raw
  `voteState`. Stale `voteState` from previous rounds is harmless — it's
  cleared alongside the round bump for cleanliness.
