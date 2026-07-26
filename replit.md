# Linda Mwananchi 2027 — Campaign Management Platform

**IT'S TIME. BE PART OF THE CHANGE.**

A production-ready Kenyan presidential campaign management platform. Manages volunteers, supporters, finances, communications, election-day operations, result verification, data-protection compliance, and comprehensive reporting from one unified command centre.

**M-Pesa Paybill: 3033049**

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (binds to PORT env var)
- `pnpm --filter @workspace/ushindi-2027 run dev` — run the frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; requires TTY)
- `pnpm --filter @workspace/api-server exec vitest run` — run backend unit tests
- `pnpm exec tsx scripts/seed.ts` — seed demo data (fictional, for development only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind + TanStack Query + Wouter + Clerk Auth
- API: Express 5 + Helmet + express-rate-limit + CORS
- DB: PostgreSQL + Drizzle ORM + Drizzle-Zod
- Auth: Clerk (`@clerk/express`, `@clerk/react`)
- Excel exports: ExcelJS
- Tests: Vitest (backend unit tests in `artifacts/api-server/tests/`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild

## Where things live

- **API routes**: `artifacts/api-server/src/routes/`
- **Frontend pages**: `artifacts/ushindi-2027/src/pages/`
- **DB schema**: `lib/db/src/schema/` (6 files: core, config, geography, portal, finance, elections, compliance)
- **RBAC middleware**: `artifacts/api-server/src/middlewares/rbac.ts`
- **AppLayout/nav**: `artifacts/ushindi-2027/src/components/layout/AppLayout.tsx`
- **Tests**: `artifacts/api-server/tests/tally.test.ts`
- **Seed data**: `scripts/seed.ts`
- **Documentation**: `docs/`

## Architecture decisions

- Pages MUST NOT wrap in `<AppLayout>` — `ProtectedRoute` in App.tsx already wraps them
- All API calls use `const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")` — never hardcode localhost
- RBAC: `resolveActor()` must be called (or run as middleware) before checking `req.actorRoles`
- Transparency portal GET uses `requireAuth + resolveActor` so `actorRoles` is populated for admin detection
- DB schema changes require `cd lib/db && pnpm exec tsc --build` to rebuild type declarations
- Compliance tables (DPIA, vendor, breach, etc.) were created via direct SQL — not via drizzle push (TTY limitation)
- Four-eyes principle: enforced at app level; `/privileged-access` screen checks no user holds conflicting roles

## Product

- **Public portal**: landing, manifesto, county priorities, events, news, volunteer/supporter registration, crowdfunding, data requests
- **Command Centre** (admin): volunteer management, supporter CRM, finance (contributions, budget, expenditure), communications, content library, events management, rapid response / fact-checking
- **Election Operations**: polling station management, agent deployment, offline-first Form 34A submission, multi-tier verification workflow, tally dashboard, incidents, disputes, transparency portal
- **Compliance**: data subject requests, DPIA register, vendor register, breach register, consent audit, retention policies
- **Reporting**: 19 downloadable report types (CSV + Excel), all exports logged to immutable audit trail
- **Security**: Helmet headers, rate limiting (global 500/15min, export 20/min), RBAC on all sensitive routes, four-eyes privilege review

## User preferences

- Brand: electric blue `#1D9BF0`, black sidebar, bold all-caps headers
- Tagline: "IT'S TIME. BE PART OF THE CHANGE."

## Gotchas

- `drizzle push` requires a TTY — use `--force` flag or run via direct SQL in CI
- After adding new schema tables, always run `cd lib/db && pnpm exec tsc --build`
- `resolveActor` must be in middleware chain before any route that reads `req.actorRoles`
- `pollingAgentsTable` uses `phoneNumber` not `phone`; `volunteersTable` uses `preferredRole` not `volunteerRole`
- `resultSubmissionsTable` uses `totalVotesCast`/`totalValidVotes`, not `totalVotes`
- `electionIncidentReportsTable` is the correct table (not `electionIncidentsTable`)
- `auditLogsTable` uses `resource`/`resourceId`/`userId` (not `entityType`/`entityId`/`actorId`)

## Pointers

- See `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `docs/` for full documentation (14 guides)
- See `docs/roles-permissions.md` for the full role and permission matrix
