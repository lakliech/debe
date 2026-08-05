---
name: Drizzle wraps pg errors — constraint detail is on err.cause
description: Detecting unique-violation/constraint errors from Drizzle requires inspecting err.cause.message, not err.message
---

Drizzle's `DrizzleQueryError` message is `"Failed query: <sql>\nparams: ..."` — the actual Postgres error (e.g. `duplicate key value violates unique constraint "users_email_unique"`) is only on `err.cause.message`. A regex like `/duplicate key/i.test(err.message)` never matches.

**Why:** A race-safe insert/recover path silently never recovered because the guard tested only the wrapper message; tests caught it.

**How to apply:** When classifying DB errors (unique violation, FK violation, etc.), test `${err?.message} ${err?.cause?.message}` together, or match the pg `code` on the cause (`23505` etc.).
