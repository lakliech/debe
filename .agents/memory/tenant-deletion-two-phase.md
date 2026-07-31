---
name: Tenant deletion is two-phase
description: Why scheduling and purging are separate, and the required teardown order.
---

Deleting a campaign is two distinct phases:
1. **Schedule** — suspends access and starts a grace period. Fully reversible. No data destroyed.
2. **Purge** — a cron job (or an explicit, slug-confirmed admin action) destroys the data.

**Why:** campaigns delete in a panic mid-race and change their minds. A single
irreversible action turns a misclick into unrecoverable loss of an election operation.
Separating the phases also gives support a window to intervene.

Within the purge, detach external systems (payment subscription, identity-provider
organisation) **before** deleting the tenant row. The row holds the only reference to
those external IDs, so deleting it first orphans a live paid subscription and an identity
org with no record that they exist.

Slug and custom-domain changes go through the same kind of review queue rather than
applying directly, because they break live public-portal links that voters and agents
already hold.

**How to apply:** any new "remove a tenant" entry point must schedule, never purge
directly. Keep the operator-facing distinction between suspend, schedule-deletion, and
purge visually unmistakable — they have wildly different blast radii.
