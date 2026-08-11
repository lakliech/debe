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
- **Frontend**: React + Vite + Tailwind + TanStack Query + Wouter + Clerk Auth + Radix UI + React Hook Form + Recharts
- **API**: Express 5 + Helmet + express-rate-limit + CORS + Pino + node-cron + ExcelJS + Google Cloud Storage
- **DB**: PostgreSQL + Drizzle ORM + Drizzle-Zod
- **Auth**: Clerk (`@clerk/express`, `@clerk/react`)
- **Mobile**: Expo 54 / Expo Router + React Native 0.81 + Clerk Expo + TanStack Query + biometrics + offline support
- **Tests**: Vitest (backend unit tests in `artifacts/api-server/src/tests/`)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec in `lib/api-spec/`)
- **Build**: esbuild

## Where things live

- **API routes**: `artifacts/api-server/src/routes/`
- **Frontend pages**: `artifacts/ushindi-2027/src/pages/`
- **DB schema**: `lib/db/src/schema/` (7 files: core, config, geography, portal, finance, elections, compliance, platform)
- **DB migrations**: `lib/db/drizzle/` (applied migrations; latest is `0023_user_roles_tenant_nullable.sql`)
- **RBAC middleware**: `artifacts/api-server/src/middlewares/rbac.ts`
- **Tenant middleware**: `artifacts/api-server/src/middlewares/resolveTenant.ts`
- **AppLayout/nav**: `artifacts/ushindi-2027/src/components/layout/AppLayout.tsx`
- **Tests**: `artifacts/api-server/src/tests/`
- **Seed data**: `scripts/seed.ts`
- **Documentation**: `docs/` (15 guides)

## Artifacts

| Artifact | Kind | Preview path | Entry |
|---|---|---|---|
| `artifacts/ushindi-2027` | web | `/` | React/Vite SPA — Command Centre + public portal |
| `artifacts/api-server` | api | `/api` | Express 5 API, port from `$PORT` |
| `artifacts/agent-mobile` | mobile | `/agent-mobile/` | Expo app — Linda Mwananchi Agent |
| `artifacts/mockup-sandbox` | design | `/__mockup` | Component preview server |

## Mobile — per-campaign APK builds

The mobile app supports white-labelled per-campaign builds. Set `EXPO_PUBLIC_TENANT_SLUG` at build time so the sign-in screen shows the correct candidate name, primary colour, and election year before the agent logs in.

- **Full guide**: `docs/mobile-campaign-build.md`
- **Env template**: `artifacts/agent-mobile/.env.example`
- **Campaign sample**: `artifacts/agent-mobile/.env.campaign` (copy and fill in per campaign)

Quick build:
```bash
cp artifacts/agent-mobile/.env.campaign artifacts/agent-mobile/.env.amina2027
# edit .env.amina2027 with the real slug + Clerk key
cd artifacts/agent-mobile && set -a && source .env.amina2027 && set +a
eas build --platform android --profile production
```

## Architecture decisions

- **Pages MUST NOT wrap in `<AppLayout>`** — `ProtectedRoute` in `App.tsx` already wraps them
- **All API calls** use `const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")` — never hardcode localhost
- **RBAC**: `resolveActor()` must run before any route that reads `req.actorRoles`. Platform routes (`/api/platform/*`) skip `resolveTenant` intentionally — they're gated by `requireLevel(0)` alone
- **NULL-tenant platform roles**: roles with `tenant_id = NULL` are platform-wide (e.g. `platform_admin`, `super-admin`). Both `resolveActor` (rbac.ts) and `getUserWithRoles` (users.ts) use `OR tenant_id IS NULL` so they are always visible regardless of which tenant is active
- **Global admins**: `is_global_admin = true` in `users` table short-circuits all RBAC checks — `resolveActor` grants `["platform_admin", "super-admin"]` at level 0 without touching `user_roles`
- **Actor cache**: `resolveActor` caches per `clerkId:tenantId` for 30s (default). Call `bustActorCache(clerkId)` after any role mutation
- **Transparency portal GET** uses `requireAuth + resolveActor` so `actorRoles` is populated for admin detection
- **DB schema changes** require `cd lib/db && pnpm exec tsc --build` to rebuild type declarations
- **Compliance tables** (DPIA, vendor, breach, etc.) were created via direct SQL — not via drizzle push (TTY limitation)
- **Four-eyes principle**: enforced at app level; `/privileged-access` screen checks no user holds conflicting roles

## Product

- **Public portal**: landing, manifesto, county priorities, events, news, volunteer/supporter registration, crowdfunding, data requests
- **Command Centre** (admin): volunteer management, supporter CRM, finance (contributions, budget, expenditure), communications, content library, events management, rapid response / fact-checking
- **Election Operations**: polling station management, agent deployment, offline-first Form 34A submission, multi-tier verification workflow, tally dashboard, incidents, disputes, transparency portal
- **Platform admin** (`/platform/*`): tenant management, Election-Day Operations Monitor, User Search & Role Inspector with cascading geography dropdowns, Billing & Revenue (MRR/ARR, trials, at-risk), Tenant Lifecycle (suspend / rename / schedule deletion / purge, plus the domain-change review queue); routes skip `resolveTenant` and require `requireLevel(0)`
- **SaaS surfaces**: neutral platform homepage (`/platform-home`), pricing (`/pricing`), self-serve campaign registration (`/register`, one campaign per founder, starts a 14-day Pro trial), campaign settings hub (`/settings`, tab-driven via `?tab=`), onboarding checklist, trial banner, and a 6-step guided demo tour
- **Geography** (`/geography`): four-column drill-down — Counties → Constituencies → Wards → Polling Stations — all fetched live from the DB (47 counties, 290 constituencies, 1,450 wards, 24,594 stations)
- **Compliance**: data subject requests, DPIA register, vendor register, breach register, consent audit, retention policies
- **Reporting**: 19 downloadable report types (CSV + Excel), all exports logged to immutable audit trail
- **Security**: Helmet headers, rate limiting (global 500/15min, export 20/min), RBAC on all sensitive routes, four-eyes privilege review

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | Clerk server-side secret |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key (server) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (Vite frontend) |
| `SEED_CLERK_ORG_ID` | Fallback org for legacy single-tenant dev |
| `SEED_BYPASS_ORG_ID` | Dev-only org bypass — must not be set in production |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `ACTOR_CACHE_TTL_MS` | RBAC actor cache TTL (default 30000) |
| `MPESA_ENV` / `MPESA_SHORTCODE` / `MPESA_PASSKEY` / `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` / `MPESA_CALLBACK_URL` | M-Pesa Daraja API |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Object storage public paths |
| `PRIVATE_OBJECT_DIR` | Object storage private directory |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Object storage bucket |
| `SESSION_SECRET` | Session signing secret |
| `ADMIN_CLEANUP_SECRET` | Auth token for admin cleanup endpoint |
| `DEMO_RESET_ENABLED` | Set `true` to enable nightly demo data reset cron |
| `PORTAL_DOMAIN` | Public portal domain for tenant resolution |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Mobile Clerk key |
| `EXPO_PUBLIC_TENANT_SLUG` | Mobile build-time campaign slug |
| `EXPO_PUBLIC_DOMAIN` | Mobile API base URL |
| `BILLING_JOBS_ENABLED` | Set `true` on ONE instance only to run the trial-expiry and tenant-purge crons |
| `PLATFORM_URL` | Absolute base URL used in emails and Stripe redirect URLs |
| `SUPPORT_EMAIL` | Address shown to campaigns in lifecycle emails |
| `EMAIL_PROVIDER` | `resend`, `sendgrid`, or unset (unset = log to stdout, status `skipped`) |
| `EMAIL_API_KEY` | API key for the chosen email provider |
| `EMAIL_FROM` | From address for transactional mail |
| `STRIPE_SECRET_KEY` | Stripe secret key. Unset = billing routes return 503 and the UI hides checkout |
| `STRIPE_WEBHOOK_SECRET` | Verifies the `/api/billing/webhook` signature |
| `STRIPE_PRO_PRICE_ID` | Stripe price for the Pro tier |
| `STRIPE_ENTERPRISE_PRICE_ID` | Stripe price for the Enterprise tier |

## User preferences

- Brand: electric blue `#1D9BF0`, black sidebar, bold all-caps headers
- Tagline: "IT'S TIME. BE PART OF THE CHANGE."
- Git: commit and push to `origin` (`github.com/lakliech/debe`, branch `main`) automatically after every completed change — never wait to be asked

## Gotchas

- `drizzle push` requires a TTY — use `--force` flag or run via direct SQL in CI
- After adding new schema tables, always run `cd lib/db && pnpm exec tsc --build`
- `resolveActor` must be in the middleware chain before any route reads `req.actorRoles`
- Platform routes (`/api/platform/*`) skip `resolveTenant` — do not add `resolveTenant` to them
- `user_roles.tenant_id` is **nullable** (migration 0023). Platform-level roles store `tenant_id = NULL`. Always query with `OR tenant_id IS NULL` when you need platform roles to show up in a tenanted context
- `pollingAgentsTable` uses `phoneNumber` not `phone`; `volunteersTable` uses `preferredRole` not `volunteerRole`
- `resultSubmissionsTable` uses `totalVotesCast`/`totalValidVotes`, not `totalVotes`
- `electionIncidentReportsTable` is the correct table (not `electionIncidentsTable`)
- `auditLogsTable` uses `resource`/`resourceId`/`userId` (not `entityType`/`entityId`/`actorId`)
- Frontend `useUserAccess` caches `/me` for 5 minutes with `retry: 2` — after a role change, either wait 5 min or invalidate the `["user-me-nav-access"]` query key
- Never read `tenants.plan` directly — call `getEffectivePlan()`. The stored column is not the granted plan (trials and manual grants ride on `planOverrideUntil`)
- The Stripe webhook must stay mounted **before** `express.json()` in `app.ts`; Stripe signs raw bytes, so a parsed body fails verification
- The frontend registers a service worker (`public/sw.js`), so a stale cached bundle can survive an HMR update. When a dev-server change appears not to apply, hard-reload or add a cache-busting query param before assuming the code is wrong
- Any page that queries an authenticated endpoint while signed out must set `enabled` on the query — the global QueryClient default is `retry: 1`, so an ungated 401 keeps `isLoading` true and pins the page on its loading state

## Pointers

- See `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `docs/` for full documentation (15 guides)
- See `docs/roles-permissions.md` for the full role and permission matrix
- See `docs/billing-plans.md` for the plan tiers, what each one unlocks, and where the gates are enforced
