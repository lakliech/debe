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

# Provision the shared read-only demo campaign. The public demo auto-login
# (GET /api/demo/session) and the nightly demo reset both require the tenant
# with slug 'demo' to exist; without this an environment has no working demo
# until somebody remembers to seed it by hand.
#
# The seed is idempotent and scoped to that one tenant. It is deliberately NOT
# fatal: demo content is a sales surface, not a prerequisite for the app, and
# wedging every future merge on it would be worse than losing the demo. The
# endpoint already refuses with a logged 503 when the tenant is missing, so the
# failure stays visible rather than silent.
if ! pnpm --filter @workspace/scripts run seed:demo; then
  echo "WARNING: demo tenant seed failed — /?demo=1 will return 503 until this is fixed."
fi
