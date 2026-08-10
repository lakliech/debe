# Threat Model

## Project Overview

Linda Mwananchi 2027 is a multi-tenant Kenyan presidential campaign management SaaS platform deployed publicly at `https://debe.ke`. It manages volunteers, supporters, finances, election-day operations (Form 34A submission, tally, result verification), aspirant declarations, communications, and compliance (DPIA, Kenya DPA). The stack is Node.js 24 / Express 5 / TypeScript (API), React / Vite / Clerk (frontend), PostgreSQL / Drizzle ORM (database), Expo / React Native (mobile), with Clerk for authentication, Google Cloud Storage for assets, M-Pesa Daraja for payments, and Stripe for SaaS billing.

## Assets

- **Election data** — live vote tally submissions (Form 34A), result verifications, incident reports, agent deployments at 24,594 polling stations. Tampering or unauthorized access could affect election outcome integrity.
- **Campaign staff PII** — email addresses, phone numbers, Clerk user IDs, role assignments, geographic scope for all campaign members. Enumeration enables targeted phishing and account takeover.
- **Aspirant PII** — national ID numbers, phone numbers, application status and internal reviewer notes for persons declaring aspirancy. Protected under Kenya's Data Protection Act 2019.
- **M-Pesa credentials** — `consumerSecret` and `passkey` stored encrypted in `tenant_mpesa_configs`; compromise enables unauthorized payment API calls.
- **Application secrets** — `SESSION_SECRET`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `MPESA_*`, `ADMIN_CLEANUP_SECRET`, `GEO_REPAIR_TOKEN`. Exposure of any allows auth bypass, payment fraud, or data destruction.
- **Tenant/campaign data** — campaign finance records, supporter/volunteer contact lists, communications content, compliance registers. Multi-tenant isolation failure leaks one campaign's data to another.
- **Role and permission definitions** — the global `roles` and `role_permissions` tables (shared, no `tenantId`). Modification affects all tenants simultaneously.

## Trust Boundaries

- **Internet → API** — all HTTP requests cross this boundary. Clerk authenticates users; the API must authorize every action. Public endpoints (public portal, registration forms) accept unauthenticated input.
- **Authenticated member → tenant data** — `resolveTenant` derives campaign context from DB membership (not request headers for authenticated users), preventing cross-tenant context spoofing. However, certain endpoints lack role authorization within the tenant boundary.
- **Campaign tenant → platform admin** — platform routes (`/api/platform/*`) skip `resolveTenant` and require `requireLevel(0)`. Global admins (`is_global_admin=true`) bypass all tenant RBAC.
- **API → PostgreSQL** — Drizzle ORM with parameterized queries; no raw string concatenation SQL observed. `tenantFilter()` helper scopes most queries.
- **API → external services** — Clerk (auth), Stripe (billing), M-Pesa Daraja (payments), Google Cloud Storage (assets), WhatsApp Business API (notifications). WhatsApp webhook uses `timingSafeEqual` HMAC verification.
- **API → admin/maintenance endpoints** — `POST /api/admin/cleanup-demo-stations` (X-Admin-Secret) and `POST /api/platform/maintenance/geography-repair` (GEO_REPAIR_TOKEN) are protected by shared-secret token checks only, without Clerk auth.

## Scan Anchors

**Production entry points:**
- `artifacts/api-server/src/app.ts` — Express app setup, middleware order, CORS, Helmet, rate limiters
- `artifacts/api-server/src/routes/index.ts` — all route mounting; `withTenant()` / `withTenantMixed()` wrappers
- `artifacts/api-server/src/routes/publicPortal.ts` — unauthenticated public routes (volunteer/supporter registration, aspirant status, transparency portal)
- `artifacts/api-server/src/routes/platform*.ts` — platform admin routes (skip resolveTenant, requireLevel(0))
- `artifacts/api-server/src/middlewares/rbac.ts` + `resolveTenant.ts` — core auth/authz enforcement

**Highest-risk code areas:**
- `artifacts/api-server/src/routes/roles.ts` — global shared role/permission mutation (no tenant scoping on roleId)
- `artifacts/api-server/src/routes/users.ts` — user list/get lacks role check; role assignment lacks target-user tenant check
- `artifacts/api-server/src/routes/rapidResponse.ts` — mass-assignment `set(req.body)` bypasses workflow columns
- `artifacts/api-server/src/routes/adminCleanup.ts` + `maintenance.ts` — non-constant-time secret comparisons on destructive endpoints
- `artifacts/api-server/src/lib/mpesa.ts` — SESSION_SECRET fallback as encryption key

**Public vs. authenticated vs. admin:**
- Public (no auth): `/api/public/*`, `/api/health`, `/api/billing/webhook`
- Authenticated tenant-member: all other `/api/*` routes via `withTenant()` / `requireAuth`
- Platform admin: `/api/platform/*` — `requireLevel(0)` only, no resolveTenant

**Dev-only / non-production:**
- `artifacts/mockup-sandbox/` — component preview, not in production API path
- `scripts/seed.ts` — dev seeding only
- `SEED_BYPASS_ORG_ID` / `DEMO_RESET_ENABLED` — must not be set in production

## Threat Categories

### Spoofing

Clerk provides JWTs for session authentication; `getAuth(req)` is called in every `requireAuth` middleware and in the tenant resolver. The main spoofing risk is the 30-second in-process actor cache (`rbac.ts`): on multi-instance autoscale deployments, `bustActorCache` evicts only the local instance's cache, so a revoked session retains cached privileges on other instances for up to 30 seconds.

**Required guarantees:** Role cache invalidation must be effective across all autoscale instances within one TTL period. Consider a shared cache (Redis) or a shorter TTL for high-privilege roles.

### Tampering

The `PUT /api/roles/:id/permissions` endpoint allows a campaign-level `security-admin` to modify the permission set of **any role in the global shared table** — including `platform_admin`. The `roles` table has no `tenantId` column, so a permission change in one campaign propagates platform-wide.

The `PATCH /api/rapid-response/claims/:id` endpoint uses `db.update().set(req.body)` with no column allowlist, allowing a `communications-officer` to write protected workflow columns (`status`, `approvedBy`, `legalClearance`) directly, bypassing the multi-step approval workflow.

**Required guarantees:** Role permission mutations must be restricted to platform-level operators only (requireLevel(0)) or limited to roles scoped to the actor's tenant. The rapid-response update endpoint must use an explicit column allowlist.

### Information Disclosure

`GET /api/users` returns full PII (email, phone, Clerk ID, roles) for all campaign members to any authenticated member with no role requirement. `GET /api/users/:id` has the same gap for individual profiles.

The public `GET /api/public/aspirants/status` endpoint accepts raw National ID + phone and returns match confirmation plus internal reviewer notes to unauthenticated callers, with a 20/15min rate limit per IP.

CSV exports from the reporting endpoint do not sanitize leading formula characters (`=`, `+`, `-`, `@`), enabling pre-positioned formula injection by unauthenticated public form submitters.

**Required guarantees:** User list/detail endpoints must require `canManageUsers` or equivalent elevated role. Aspirant status endpoint must not return reviewer notes in public responses and should use token-gated lookups. CSV export must prefix formula-triggering characters.

### Denial of Service / Data Destruction

`POST /api/admin/cleanup-demo-stations` uses a non-constant-time `!==` comparison on `ADMIN_CLEANUP_SECRET` with only the global rate limiter (500/15min), making the secret recoverable via timing measurement in ~46 minutes. Successful brute-force enables irreversible deletion of polling station data.

`POST /api/platform/maintenance/geography-repair` has the same timing vulnerability on `GEO_REPAIR_TOKEN`, with no Clerk authentication, enabling unauthenticated callers to trigger a full geography re-seed while the token is configured.

**Required guarantees:** All shared-secret comparisons must use `crypto.timingSafeEqual`. Destructive admin endpoints must have dedicated strict rate limiters (≤ 5 req/15min). `GEO_REPAIR_TOKEN` must be removed from the environment as soon as the repair phase is complete.

### Elevation of Privilege

`POST /api/users/:id/roles` (role assignment) does not verify that the target user belongs to the actor's tenant before inserting the role. A campaign executive director can assign any role — including `platform_admin` (level 0) — to any user on the platform.

The `SESSION_SECRET` is silently used as the M-Pesa credential encryption key when `MPESA_CONFIG_ENCRYPTION_KEY` is absent. Exposure of `SESSION_SECRET` decrypts all stored M-Pesa `consumerSecret` and `passkey` values for every tenant.

**Required guarantees:** Role assignment must call `userBelongsToTenant` on the target user before inserting. `MPESA_CONFIG_ENCRYPTION_KEY` must be required at startup; the `SESSION_SECRET` fallback must be removed.
