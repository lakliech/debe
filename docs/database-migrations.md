# Database Migrations

This project uses **Drizzle ORM** with a schema-push workflow.

## Development

In development, use `drizzle push` to apply schema changes directly:

```bash
pnpm --filter @workspace/db run push
```

This compares the TypeScript schema (`lib/db/src/schema/`) to the live database and applies differences interactively. It will prompt before dropping columns or tables.

> ⚠️ Never run `push` in production — use generated migrations instead.

## After Schema Changes

After editing any schema file, rebuild the TypeScript declarations:

```bash
cd lib/db && pnpm exec tsc --build
```

This is required for the API server to pick up the new types.

## Production Migrations

1. Generate a migration from schema diff:
```bash
pnpm --filter @workspace/db exec drizzle-kit generate
```

2. Review the generated SQL in `lib/db/drizzle/`

3. Apply the migration:
```bash
pnpm --filter @workspace/db exec drizzle-kit migrate
```

## Schema Files

| File | Tables |
|---|---|
| `lib/db/src/schema/core.ts` | `users`, `user_roles`, `roles`, `permissions` |
| `lib/db/src/schema/config.ts` | `system_config`, `branding`, `audit_logs`, `volunteers`, `supporters`, `elections`, etc. |
| `lib/db/src/schema/geography.ts` | `counties`, `constituencies`, `wards`, `polling_centres`, `polling_stations` |
| `lib/db/src/schema/portal.ts` | `manifesto_sectors`, `news_articles`, `faq_items`, `consent_records`, `training_courses`, etc. |
| `lib/db/src/schema/finance.ts` | `contributions`, `budget_categories`, `budget_lines`, `expenditure_requests`, `payment_vouchers` |
| `lib/db/src/schema/elections.ts` | `presidential_candidates`, `submission_candidate_votes`, `polling_agent_allowances`, `election_incidents`, `election_disputes`, etc. |
| `lib/db/src/schema/compliance.ts` | `data_subject_requests`, `dpia_register`, `vendor_register`, `data_breach_register`, `consent_audit`, `data_retention_policies`, `export_audit_log` |

## Backup Before Migrations

Always take a snapshot before applying production migrations:

```bash
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d%H%M%S).sql
```
