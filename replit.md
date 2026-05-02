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
