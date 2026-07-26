# Local Development Setup

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ (or a Neon/Supabase account)

## Steps

### 1. Install dependencies

```bash
pnpm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env` with:
- `DATABASE_URL` — PostgreSQL connection string (e.g. `postgres://user:pass@localhost:5432/linda`)
- `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — from your Clerk dashboard
- `VITE_CLERK_PUBLISHABLE_KEY` — same as publishable key

See [environment-variables.md](environment-variables.md) for the full list.

### 3. Push DB schema

```bash
pnpm --filter @workspace/db run push
```

This applies all schema changes to your database using Drizzle's push mode.

### 4. Seed demo data (optional)

```bash
pnpm exec tsx scripts/seed.ts
```

Seeds 47 counties, sample polling stations, fictional volunteers/supporters/donations, election candidates, result submissions, incidents, disputes, compliance records, and retention policies.

> ⚠️ All seed data is fictional and labelled `[DEMO DATA — FICTIONAL]`.

### 5. Start development servers

**Terminal 1 — API server:**
```bash
pnpm --filter @workspace/api-server run dev
```

**Terminal 2 — Frontend:**
```bash
pnpm --filter @workspace/ushindi-2027 run dev
```

Or via pnpm workspace:
```bash
pnpm -r run dev
```

### 6. Create your account

1. Go to `http://localhost:5173/sign-up`
2. Create an account with your email
3. In the database, assign yourself the `super-admin` role via the `user_roles` table
4. Navigate to `/roles` to manage roles for other users

## Common Commands

```bash
pnpm run typecheck            # typecheck all packages
pnpm run build                # build all packages
pnpm --filter @workspace/api-server exec vitest run   # run backend tests
pnpm --filter @workspace/api-spec run codegen         # regenerate API client from OpenAPI spec
```

## Troubleshooting

**API starts but returns 500:**
- Check `DATABASE_URL` is set and the DB is accessible
- Run `pnpm --filter @workspace/db run push` to ensure schema is up to date

**Clerk errors on sign-in:**
- Verify `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` match
- Check `CLERK_SECRET_KEY` is set on the API server

**TypeScript errors after schema changes:**
- Run `cd lib/db && pnpm exec tsc --build` to rebuild the DB package type declarations
