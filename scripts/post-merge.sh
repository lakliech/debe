#!/bin/bash
set -e

# Install / update dependencies (frozen to avoid accidental lockfile drift)
pnpm install --frozen-lockfile

# Apply DB schema: generate a migration file for any new schema changes,
# then migrate non-interactively.  Both commands are safe to run when
# there is nothing new to do (generate prints "No schema changes" and
# exits 0; migrate skips already-applied files).
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run migrate
