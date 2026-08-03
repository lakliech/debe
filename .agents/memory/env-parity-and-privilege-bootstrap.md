---
name: Dev/production parity and privilege bootstrap
description: Why "fixed in dev" can mean nothing to a user testing production, and how the first platform operator must be granted safely.
---

# A fix verified in development may be invisible to the user

Development and production are **separate databases**. Publishing propagates
schema, not rows. So a defect whose real cause is *missing production data*
survives every code fix, and the user — who is looking at the published app —
sees no change at all while each round of work verifies clean in dev.

**Why:** several consecutive rounds of RBAC work were verified against dev and
reported as fixed. The user kept saying the problem persisted. Dev logs showed
only 401s (nobody had ever signed in there); the deployment logs showed a live
session getting 403 on every authenticated endpoint. Production had no
campaigns, no role assignments, and the owner's global-admin flag unset.

**How to apply:** when a user insists a bug persists after a verified fix, first
establish *which environment they are looking at*. Compare the two directly —
row counts of the tables the feature depends on, and the specific flags for the
affected account — before touching code again. Deployment logs versus workflow
logs will usually settle it in one step: differing status codes for the same
endpoint means you are debugging the wrong environment.

# An empty environment must be able to recover itself

A permission system where granting access is itself a privileged action has no
in-app recovery path: a fresh deployment where nobody holds the top role locks
the owner out permanently. Ship a startup bootstrap that grants the first
operator from an environment-variable allowlist, and make it idempotent so it
is safe on every boot.

## Never match a privilege allowlist on a locally-stored email

Match against the **identity provider's verified primary address**, resolved to
the provider's user ID, and look the local row up by that ID.

**Why:** the local user table's email column was writable from a request body
(a registration endpoint accepted a contact email). Matching the allowlist on
that column let any signed-in caller claim the owner's address and be promoted
on the next boot. The provider's own verified address is the only trustworthy
input. Locally-minted placeholder addresses must also be excluded explicitly —
they are synthesised from a user ID and prove nothing.

**How to apply:** allowlist → provider lookup → provider user ID → local row.
Re-verify inside the promotion function itself, not only at the call site, so
the function is safe from every caller. Treat a lookup failure as fail-closed.

## Two things that are easy to forget

- **Bust the actor/permission cache after promoting.** If the server starts
  listening before the bootstrap finishes, an early request caches
  "no privileges" and the freshly promoted operator keeps getting 403 until
  that entry expires.
- **Open the port before startup housekeeping.** The platform kills a workflow
  that is slow to listen, so database work at boot belongs after `listen`, in
  the background, swallowing its own errors.

## Role catalogue sync should be insert-only

Boot-time catalogue sync should add missing roles but not rewrite descriptive
fields, or every deploy silently reverts operator edits. Keep the privilege
level itself code-owned — that one decides access and must not drift.
