# Outreach.io

A full-featured clone of instantly.ai — a cold email outreach and sales automation platform.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/instantly run dev` — run the frontend (Vite dev server)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui, Recharts for charts, Wouter for routing
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/api.ts` — generated React Query hooks
- `lib/api-zod/src/generated/` — generated Zod schemas for validation
- `lib/db/src/schema/` — Drizzle ORM schema files
- `artifacts/instantly/src/pages/` — all frontend pages
- `artifacts/instantly/src/components/layout/app-layout.tsx` — sidebar nav layout
- `artifacts/api-server/src/routes/` — all API route handlers

## Architecture decisions

- Contract-first: OpenAPI spec drives both client hooks and server Zod validation
- Dark-mode-first UI theme: deep navy/slate background with cyan primary (`199 89% 48%`)
- Rates (open rate, reply rate, bounce rate) are always stored as raw counts and computed as percentages on-demand — never stored as percentages
- Campaign analytics are computed on-the-fly from the campaign's count columns
- Inbox uses sentiment analysis labels (positive/neutral/negative) stored with each message

## Product

- **Dashboard** — high-level stats (sent, open rate, reply rate, active campaigns) with a daily volume chart
- **Campaigns** — list, create, launch/pause, and manage campaigns with full detail view (Overview, Sequence steps, Leads)
- **Leads** — searchable lead database with add/delete, filterable by email/name/company
- **Email Accounts** — connect Gmail/Outlook/SMTP accounts, toggle warmup, monitor health score and daily send limits
- **Inbox** — unified reply inbox with sentiment indicators (Positive/Neutral/Negative), star, archive, mark read/unread
- **Analytics** — summary stats, 30-day area chart (Sent/Opened/Replied), top campaigns by reply rate

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Rates from the API are already percentages (e.g. `29.2` not `0.292`) — do NOT multiply by 100 in the UI
- Daily stats table has no unique constraint on `date` — avoid duplicate inserts
- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI spec changes before editing frontend code
- Always run `pnpm --filter @workspace/db run push` after schema changes in `lib/db/src/schema/`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
