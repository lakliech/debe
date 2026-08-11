---
name: Drizzle upsert payload must satisfy NOT NULL even on the update path
description: INSERT ... ON CONFLICT DO UPDATE still evaluates the full INSERT row; nulls in notNull columns fail before the conflict is detected.
---

With Drizzle's `db.insert(t).values(v).onConflictDoUpdate(...)`, the INSERT
payload is built in full before conflict detection, and Postgres enforces
NOT NULL on that proposed row. So when a column is meant to be "kept" on
update (e.g. a secret the client omitted because blank means "unchanged"),
you cannot put `null` in the insert payload and rely on the conflict to
route to UPDATE — it 500s with a constraint violation first.

**Rule:** the insert payload must be valid on its own. For keep-on-update
columns, fall back to the existing row's stored value
(`new ?? existing.column`) in `values(...)`; the conflict path discards it.

**Why:** this cost a test cycle in the platform messaging routes — the
"blank secret keeps the stored one" update path 500'd even though the
ON CONFLICT branch never touched the column.

**How to apply:** any `onConflictDoUpdate` where some values are
conditionally computed. Eagerly validating the insert row is also what
makes `encryptSecret(undefined)` style bugs visible — compute optional
secrets into a variable first, then decide the payload.
