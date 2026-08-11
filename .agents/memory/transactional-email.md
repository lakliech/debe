---
name: Transactional email sending
description: Rules for adding or changing lifecycle emails — non-blocking delivery, the three-status log, and where recipients come from.
---

# Transactional email

## Sending must never affect the triggering action

Every lifecycle email is dispatched **after** its transaction commits, fire-and-forget.
The send helper swallows its own errors and returns a status instead of throwing.

**Why:** email is a side effect of a user action. A provider outage or a bad API key
must not roll back a suspension, a tenant creation, or a role grant. A helper that
throws inside a route handler turns a provider incident into a 500 on a core workflow.

**How to apply:** call the async/fire-and-forget variant from request handlers, after
the DB write. Only the cron jobs await a send, because they care about the result for
their own idempotency bookkeeping.

## Three statuses, and "skipped" is not a failure

Delivery is logged as `sent | failed | skipped`. `skipped` means no provider is
configured and the body went to stdout instead.

**Why:** development and most preview environments have no provider key. Collapsing
`skipped` into `failed` makes every non-production environment look broken, and
collapsing it into `sent` makes a missing production key invisible. "We never got the
email" is answered by which of the three it was.

**How to apply:** never render these three as a boolean in UI or alerts. Keep the
console fallback path working — it is what makes the flows testable without credentials.

## The email log is also the idempotency ledger

The trial-expiry cron decides "already warned" by querying recent non-failed log rows
for that tenant + template, rather than keeping a separate marker table.

**Why:** exact-day matching stops a daily re-send, but a restart or a second instance
on the same day would still re-warn.

**How to apply:** if you add a recurring email, either reuse this "recent log row"
guard or add a real marker — do not assume the schedule alone prevents duplicates.
This also means log rows are load-bearing: do not prune them aggressively.

## Recipients are configuration, never inferred

Campaign-facing mail goes to `tenants.billing_email`. Platform security digests go to
the `PLATFORM_ADMIN_EMAILS` allowlist, falling back to `SUPPORT_EMAIL`.

**Why:** the billing email is deliberately allowed to differ from the admin's login
email, and picking "some admin's address" instead would leak campaign state to whoever
happens to hold a role. For security alerts, the allowlist is already the set of
addresses trusted with operator standing.

**How to apply:** when neither is set, log a warning and send nothing. Do not fall back
to a hardcoded address.

## Security alerts fire on the state change, not the code path

The "new global admin" alert triggers off the UPDATE that actually flipped the flag
(guarded by `is_global_admin = false` in its WHERE clause), not off the promote
function being called.

**Why:** the promote path re-runs for every allowlisted account on every boot. Alerting
on the call would mail the platform team on each restart and train them to ignore it.

**How to apply:** for any "privileged thing happened" alert, gate on a returned row or
a computed delta that proves something changed. A no-op save is not news.
