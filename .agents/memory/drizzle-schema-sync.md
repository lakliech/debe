---
name: Drizzle schema sync convention
description: How schema changes reach the database in this project — push, not migrate; silent push failures; unique-constraint ordering quirks.
---

Schema changes propagate via `pnpm --filter @workspace/db push` (drizzle-kit push) from `lib/db/src/schema` — the schema files are the source of truth. Do NOT rely on `pnpm migrate`: the drizzle journal is drifted (several migrations were applied outside the journal), so migrate would build a wrong DB, and `drizzle-kit generate` against the drifted snapshots would emit a huge incorrect diff. `scripts/post-merge.sh` uses push and must keep doing so.

Three non-obvious failure modes, all hit in practice:

1. **`push --force` exits 0 even when it fails.** On an interactive prompt (non-TTY) it prints "Interactive prompts require a TTY terminal" but exits 0 — a silent no-op. Any automation must grep the output for that string / `^Error:` and fail loudly (post-merge.sh does this).
2. **Multi-column `unique().on(...)` column order must be alphabetical by DB column name.** drizzle-kit introspection canonicalizes constraint columns alphabetically; any other schema order makes every push want to drop+recreate the constraint, prompting to truncate the table (data-loss risk if forced). When adding a new multi-column unique, order columns alphabetically in the schema.
3. **Column-level `.unique()` must exist in the DB as a CONSTRAINT, not a bare unique index.** An identically-named unique index does not satisfy the diff; push will try to ADD the constraint and fail on the name. Convert with `DROP INDEX x; ALTER TABLE ... ADD CONSTRAINT x UNIQUE (...)`.

**Why:** Journal drift accumulated from schema-first development + narrow SQL ALTERs. Each quirk above cost a debugging round; push failing silently is the dangerous one (setup reported green while the schema was never applied).

**How to apply:** For narrow changes, apply the exact `ALTER TABLE` via SQL (executeSql), then run `pnpm --filter @workspace/db run push-force` and confirm it prints "[✓] Changes applied" with no prompt error. To find drift systematically, dump schema columns/types via `getTableColumns().getSQLType()` and diff against `information_schema`. Remember the production database needs the same change at publish time — schema sync is part of shipping, not automatic.
