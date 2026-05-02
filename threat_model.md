# Threat Model

## Project Overview

This is a pnpm TypeScript monorepo with an Express 5 API server, PostgreSQL database accessed through Drizzle ORM, generated OpenAPI/Zod request schemas, and Vite/React frontends for ThumbBattle and xMagicy. ThumbBattle lets public users view and vote on YouTube-style thumbnails, submit thumbnails for moderation, join a waitlist, and send beta feedback. xMagicy exposes a public contact form. There is currently no production authentication or admin authorization code in the API.

## Assets

- **Database records** -- thumbnail metadata, battle/vote history, ELO rankings, waitlist emails, feedback, and xMagicy contact submissions. These records are valuable for product integrity and contain personal data where emails/contact messages are collected.
- **Object storage contents and quotas** -- upload URLs permit clients to write objects into the configured private object directory, and object routes can serve stored files. Abuse can expose private files or consume storage/bandwidth.
- **Application secrets** -- `DATABASE_URL`, object-storage credentials supplied through the Replit sidecar, and deployment environment variables. These must remain server-side and out of logs/client bundles.
- **Public site integrity** -- leaderboard ordering, vote counts, pending thumbnail moderation state, and submitted URLs must not be trivially tampered with by untrusted clients.

## Trust Boundaries

- **Browser to API** -- all requests to `artifacts/api-server/src/routes/*` originate from untrusted clients. Zod validation protects request shapes, but authentication, authorization, rate limiting, and business-rule enforcement must be server-side.
- **API to PostgreSQL** -- route handlers use Drizzle queries against Postgres. SQL injection risk is reduced by ORM query construction, but unbounded public writes/updates can still damage data integrity and availability.
- **API to Object Storage** -- the API asks the Replit object-storage sidecar for signed upload URLs and proxies object downloads from Google Cloud Storage. Object paths and signed URLs cross from server-controlled storage into untrusted clients.
- **Public versus moderated content** -- active thumbnails are public; user-submitted thumbnails are intended to remain pending until admin approval. Routes that display or update thumbnails must preserve this boundary.
- **Production versus dev-only artifacts** -- `artifacts/api-server`, `artifacts/thumbbattle`, `artifacts/xmagicy`, and shared `lib/*` packages are production-relevant. `artifacts/mockup-sandbox` is a development/experimental environment and is out of production scope unless explicitly deployed.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, and `artifacts/api-server/src/routes/`.
- Highest-risk routes: `routes/storage.ts` and `lib/objectStorage.ts` for upload/download authorization; `routes/battles.ts` for vote/ranking integrity; `routes/contact.ts`, `routes/feedback.ts`, `routes/waitlist.ts`, and `routes/thumbnails.ts` for public database writes.
- Shared validation/schema code: `lib/api-zod/src/generated/api.ts`, `lib/api-spec/openapi.yaml`, and `lib/db/src/schema/*`.
- Production frontends: `artifacts/thumbbattle/src` and `artifacts/xmagicy/src`. Dev-only frontend: `artifacts/mockup-sandbox`.
- Deterministic scan note: a SAST dynamic-component finding in `artifacts/mockup-sandbox/src/App.tsx` is dev-only under this threat model and should not be reproposed unless production reachability is demonstrated.

## Threat Categories

### Spoofing

There is no deployed user authentication boundary today. Any endpoint that creates, updates, or serves user-specific or private resources must either remain intentionally public or add server-side authentication before launch. If authentication is later added, every protected API route must validate the session/token server-side and must not rely on frontend-only controls.

### Tampering

Untrusted clients can submit thumbnails, cast votes, and write contact/feedback/waitlist records. The server must validate request shape and business rules, ensure only active thumbnails can affect public rankings, prevent repeated automated manipulation where rankings matter, and keep pending content from becoming visible without moderation.

### Repudiation

Public write endpoints currently store limited context such as user-agent and IDs. If submissions, voting, or admin moderation become sensitive operational workflows, the system needs audit records that identify the actor, timestamp, affected records, and moderation decisions.

### Information Disclosure

Object-storage download routes must not expose private objects without authorization. API responses should avoid returning internal errors, stack traces, object-storage implementation details, or unnecessary PII. Logs must not include secrets, authorization headers, cookies, or full sensitive message contents.

### Denial of Service

Unauthenticated public endpoints can write to Postgres and request signed object-storage upload URLs. These routes must bound body sizes, content lengths, object upload sizes/types, and request rates to prevent spam, storage exhaustion, database bloat, or expensive repeated random/order queries.

### Elevation of Privilege

The API must enforce admin-only moderation and object ACL decisions server-side when those features exist. Object access checks must not be left as examples or comments on production routes that serve private resources. Database queries should remain parameterized through Drizzle and raw SQL fragments should not incorporate user-controlled strings.