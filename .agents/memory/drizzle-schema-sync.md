---
name: Drizzle schema sync convention
description: How schema changes reach the database in this project — push, not migrate; and the non-interactive push failure mode.
---

Schema changes propagate via `pnpm --filter @workspace/db push` (drizzle-kit push) from `lib/db/src/schema` — the schema files are the source of truth. Do NOT rely on `pnpm migrate`: the drizzle journal is drifted (several migrations were applied outside the journal), so migrate would build a wrong DB, and `drizzle-kit generate` against the drifted snapshots would emit a huge incorrect diff.

`drizzle-kit push` aborts with "Interactive prompts require a TTY terminal" when it detects an ambiguous diff (e.g. column widen/rename candidates) in a non-interactive shell.

**Why:** Hit while making `tenants.clerk_org_id` nullable — push pulled the schema, wanted to prompt, and crashed. `--force` exists but is risky here precisely because drift means the computed diff may contain more than your change.

**How to apply:** For narrow, well-understood changes, apply the exact `ALTER TABLE` directly via SQL (executeSql), then let push confirm no remaining diff. Reserve `--force` for cases where you have verified the full diff is only yours. Remember the production database needs the same change at publish time — schema sync is part of shipping, not automatic.
