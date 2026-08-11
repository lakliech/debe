# — Campaign Management Platform

**IT'S TIME. BE PART OF THE CHANGE.**

A production-ready presidential campaign management platform for Kenya's 2027 General Election. Built to manage volunteers, supporters, finances, communications, election-day operations, result verification, and data-protection compliance from one unified command centre.

---

## Quick Start

See [local-setup.md](local-setup.md) for full local development setup.

```bash
git clone <repo>
pnpm install
cp .env.example .env          # fill in DATABASE_URL and Clerk keys
pnpm run db:push              # apply DB schema
pnpm run dev                  # start API + frontend
```

---

## Documentation Index

| Document | Description |
|---|---|
| [local-setup.md](local-setup.md) | Local development setup guide |
| [environment-variables.md](environment-variables.md) | All environment variables |
| [database-migrations.md](database-migrations.md) | Schema migration instructions |
| [deployment.md](deployment.md) | Deploying to production |
| [security-architecture.md](security-architecture.md) | Security model and threat landscape |
| [roles-permissions.md](roles-permissions.md) | Role and permission matrix |
| [data-protection.md](data-protection.md) | Data protection and GDPR compliance guide |
| [election-day-operations.md](election-day-operations.md) | Election-day operations guide |
| [results-verification.md](results-verification.md) | Results verification workflow |
| [backup-disaster-recovery.md](backup-disaster-recovery.md) | Backup and disaster recovery |
| [api-documentation.md](api-documentation.md) | API reference |
| [billing-plans.md](billing-plans.md) | Plan tiers, feature gates, and upgrade prompts |
| [administrator-guide.md](administrator-guide.md) | Administrator guide |
| [polling-agent-quickstart.md](polling-agent-quickstart.md) | Polling agent quick-start (field guide) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Linda Mwananchi Platform               │
├──────────────────┬──────────────────────────────────────┤
│  React + Vite    │  Express 5 API Server                 │
│  (ushindi-2027)  │  (api-server)                         │
│                  │                                       │
│  Clerk Auth      │  Drizzle ORM + PostgreSQL             │
│  TanStack Query  │  Helmet + Rate Limiting               │
│  Wouter Router   │  RBAC Middleware                      │
│  Recharts        │  Clerk JWT Verification               │
└──────────────────┴──────────────────────────────────────┘
```

## Key Design Decisions

1. **Clerk for authentication** — zero password management, built-in MFA, device tracking
2. **RBAC with role levels** — 14+ roles; level 1 = super-admin, level 10 = field volunteer
3. **Drizzle ORM** — type-safe SQL, schema-as-code, push-based migrations in dev
4. **Offline-capable Agent PWA** — `/agent/results` works with degraded connectivity
5. **Four-eyes principle** — no single user may hold tally-alteration + payment-approval + audit-erasure privileges simultaneously
6. **Immutable audit log** — `audit_logs` table has no DELETE route; the privileged-access review screen enforces this

## Live Demo

Try the platform without signing up at **[demo.debe.ke](https://demo.debe.ke)** — a pre-seeded campaign environment running on the `pro` plan.

| Role | Email | Password |
|---|---|---|
| Campaign Admin | admin@demo.debe.ke | `Demo@2027!` |
| County Coordinator | coord@demo.debe.ke | `Demo@2027!` |
| Field Agent | agent@demo.debe.ke | `Demo@2027!` |

> The demo tenant is **read-only** — all POST / PUT / PATCH / DELETE requests are blocked with a 403. Sign up for a real campaign to make changes.
>
> Demo data is reset nightly. Any accounts you create will be removed.

---

## M-Pesa Integration

Paybill: **3033049** — all donations via M-Pesa are matched to contributions via `mpesaRef`.

---

## Development Only

> **⚠️ The following credentials are for the DEMO seed data only. They are fictional and must never be used in production.**

After running `pnpm exec tsx scripts/seed.ts`:
- Create accounts at `/sign-up` with any email
- Assign roles at `/roles` (requires super-admin)
- Demo data is labelled `[DEMO DATA — FICTIONAL]` throughout
