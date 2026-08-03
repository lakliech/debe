---
name: Identity is not tenant context
description: Why a platform operator must never be given an inferred campaign, and how "no campaign selected" has to be represented end to end.
---

## Rule

Never infer a tenant for a user who does not have one. A platform operator
(global admin) holds **no campaign** until they explicitly enter one, and that
choice must be persisted on the user row — not derived from a query.

Identity routes (`/me` and anything that answers "who am I") must live
**outside** the tenant boundary. Campaign routes live inside it.

**Why:** the system originally resolved a tenant for global admins by picking
the oldest non-suspended one. That made the operator's effective context a
function of unrelated DB state: suspending or adding a campaign silently moved
their privileges, role grants landed in an arbitrary campaign, and their
platform-level roles (held at `tenant_id NULL`) made them invisible in every
campaign's user management screen. The reported symptom was "the superadmin
keeps losing privileges", which looks like an RBAC bug but is a context bug.

**How to apply:** when adding a route, decide first whether it is identity or
campaign-scoped. If campaign-scoped, it must sit behind the tenant-context
guard. If it can be reached with no campaign, it must say so with the shared
"no campaign selected" code — never a 500, and never a silently unscoped query.

## Consequence: three kinds of router

- **Tenant-only** — guarded centrally; handlers can assume a campaign exists.
- **Mixed (public + authenticated on one router)** — cannot be blanket-guarded,
  because the public endpoints must stay reachable with no campaign. Every
  optional-tenant read in these must reject explicitly, and their catch blocks
  must route through the shared error responder so the "no campaign" case does
  not surface as a 500.
- **Platform** — must work with no campaign at all.

## Testing note

Tests that exercise a paid feature must give the fixture tenant an *effective*
entitlement (see the plan-resolution note), not just a stored plan tier — a
stored `pro` with no subscription and no override resolves to free.
