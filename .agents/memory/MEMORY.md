# Agent Memory Index

- [Effective plan vs stored plan](saas-plan-resolution.md) — never trust `tenants.plan`; trials and manual grants ride on an override expiry, so one resolver is the only truth.
- [Stripe webhook body parsing](stripe-webhook-raw-body.md) — the webhook route must be mounted before the global JSON parser or every signature check fails.
- [Tenant deletion is two-phase](tenant-deletion-two-phase.md) — schedule then purge, and detach external systems before the DB row that records them.
- [Service worker masks dev changes](vite-service-worker-stale-bundle.md) — a cached bundle can survive HMR; rule out staleness before debugging the code.
- [Gate queries on auth state](react-query-auth-gating.md) — an ungated authenticated query retries its 401 and pins the page on a loading spinner.
