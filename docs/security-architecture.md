# Security Architecture

## Threat Model

The Linda Mwananchi platform operates in a high-stakes election environment where adversaries may attempt to:
- Manipulate result submissions (insider threat or external attack)
- Exfiltrate voter/supporter/donor personal data
- Disrupt operations on election day (DoS, credential stuffing)
- Impersonate campaign officials

## Defence Layers

### 1. Authentication — Clerk (JWT)

- All API routes require a valid Clerk JWT (`requireAuth`)
- JWTs are short-lived and verified on every request by Clerk's middleware
- Clerk enforces MFA for admin roles (configure in Clerk dashboard)
- Session management with device registration and suspicious-login alerts

### 2. Authorisation — RBAC

- 14 roles, 10 privilege levels
- `requireRoles([...slugs])` on every sensitive route
- `resolveActor()` lazily populates `req.actorRoles` from the DB
- Super-admin is the only role that bypasses role checks
- Four-eyes principle enforced at the application layer (see `/privileged-access`)

### 3. Secure Headers — Helmet

Applied globally in `app.ts`:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `X-XSS-Protection`
- `Referrer-Policy`

Content-Security-Policy is managed separately (disabled in dev to allow Clerk iframe).

### 4. Rate Limiting

| Limiter | Window | Max Requests | Applied To |
|---|---|---|---|
| Global | 15 min | 500 | All routes |
| Auth | 15 min | 30 | Authentication endpoints |
| Export | 1 min | 20 | `/api/reporting/export` |

### 5. Input Validation

- All POST/PATCH routes use explicit field whitelists (no `req.body` spreads)
- Numeric fields are parsed/coerced before DB insertion
- String fields are sanitised against the DB schema column list
- Zod validation on the OpenAPI-generated client layer

### 6. CORS

- Explicit origin allowlist in `app.ts`
- Configurable via `CORS_ORIGINS` environment variable
- `credentials: true` with allowlist (not wildcard)
- Same-origin requests (no `Origin` header) are allowed

### 7. File Upload Security

- Uploads go to signed GCS URLs (never directly to the API server)
- File hash verification before storage
- Upload audit trail in `audit_logs`

### 8. Audit Logging

- Every mutating action logged to `audit_logs` with actor, IP, user-agent, before/after values
- No DELETE route on `audit_logs` — records are immutable
- The Privileged Access Review (`/privileged-access`) verifies no single user holds audit-management + tally-alteration + payment-approval roles simultaneously

### 9. Database Security

- Drizzle ORM with parameterised queries (no raw SQL interpolation)
- No DB credentials in application code — only `DATABASE_URL` env var
- Read/write DB user; no DDL privileges in production
- Encryption at rest via cloud provider

### 10. Export Controls

- All data exports require one of: `campaign-exec-director`, `national-campaign-manager`, `returning-officer`, `finance-manager`, `county-coordinator`, `data-officer`
- Every export logged to `export_audit_log` (reporter, type, format, row count, IP, timestamp)
- Rate limited to 20 exports/minute

## Known Limitations & Accepted Risks

| Risk | Mitigation | Residual Risk |
|---|---|---|
| Clerk dependency | Self-hosted fallback not implemented | Medium — mitigated by Clerk SLA |
| CSP disabled in dev | Enabled via Helmet in prod | Low |
| No CSRF token (SPA) | Same-site cookies + CORS allowlist | Low — Clerk JWT in Authorization header |
| Offline agent form | Local storage in browser; no server-side encryption | Medium — mitigated by HTTPS |
