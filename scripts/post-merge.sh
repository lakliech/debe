#!/bin/bash
set -e

# Install / update dependencies (frozen to avoid accidental lockfile drift)
pnpm install --frozen-lockfile

# Apply DB schema. Project convention: push straight from the schema files.
# drizzle-kit generate/migrate is unsafe here — the migration journal drifts
# from the real DB state (schema is synced via push + narrow ALTERs).
# NOTE: drizzle-kit push --force exits 0 even when it FAILS on an interactive
# column-conflict prompt (no TTY in post-merge). Capture output and fail
# loudly instead of silently skipping the schema sync.
PUSH_LOG=$(mktemp)
pnpm --filter @workspace/db run push-force 2>&1 | tee "$PUSH_LOG"
if grep -q "Interactive prompts require a TTY\|^Error:" "$PUSH_LOG"; then
  echo "POST-MERGE SETUP FAILED: drizzle push hit a column-conflict prompt — DB has drifted from the schema files."
  echo "Reconcile with a narrow ALTER via SQL (see lib/db/ddl/) and update lib/db/src/schema to match."
  exit 1
fi
