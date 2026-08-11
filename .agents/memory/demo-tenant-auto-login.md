---
name: Demo tenant auto-login
description: Why the public demo signs visitors in with a Clerk ticket, and the invariants that keep an unauthenticated grant safe.
---

Prospective customers get into the read-only demo campaign without signing up:
the API mints a short-lived **Clerk sign-in ticket** for one fixed shared demo
account, and the browser exchanges it for a real session.

**Why a ticket rather than a bespoke demo JWT or session cookie:** every
tenant-resolution and RBAC path in this app keys off a real Clerk session. A
second credential type would need its own verification branch in that
middleware — a second way to be authenticated is exactly the kind of thing that
later grants more than intended.

Invariants worth defending, because this is the only endpoint that hands out an
identity to a caller who has proved nothing:

- **No caller input.** The endpoint takes no parameters and grants exactly one
  account on exactly one tenant. Adding a tenant/role/email parameter turns it
  into an authentication bypass.
- **Refuse, never degrade.** Missing config, missing demo tenant, suspended
  demo tenant, or a demo account that has somehow been flagged as a platform
  operator must all stop the flow with a logged error. Signing the visitor into
  *something else* is worse than showing them an error.
- **Safety comes from the tenant being read-only, not from a small role.** The
  demo account deliberately holds a full campaign role so the guided tour can
  open every screen it highlights; writes are refused because of the tenant.

**How to apply:** if the demo ever needs per-visitor isolation (a writable
demo, personalised data), that is a different design — a tenant per visitor
with a TTL — not a loosening of this endpoint.

The demo tenant itself is provisioned by the idempotent demo seed, which the
post-merge setup script runs; an environment that skipped it has no demo at all.
