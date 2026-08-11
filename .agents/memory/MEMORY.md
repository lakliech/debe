# Agent Memory Index

- [Effective plan vs stored plan](saas-plan-resolution.md) — never trust `tenants.plan`; trials and manual grants ride on an override expiry, so one resolver is the only truth.
- [Stripe webhook body parsing](stripe-webhook-raw-body.md) — the webhook route must be mounted before the global JSON parser or every signature check fails.
- [Tenant deletion is two-phase](tenant-deletion-two-phase.md) — schedule then purge, and detach external systems before the DB row that records them.
- [Service worker masks dev changes](vite-service-worker-stale-bundle.md) — a cached bundle can survive HMR; rule out staleness before debugging the code.
- [Gate queries on auth state](react-query-auth-gating.md) — an ungated authenticated query retries its 401 and pins the page on a loading spinner.
- [RBAC level scale](rbac-level-scale.md) — lower = more privileged; the client must read levels off the API, never keep its own slug→level table.
- [Identity is not tenant context](identity-vs-tenant-context.md) — never infer a campaign for an operator; "lost privileges" is usually a context bug, not RBAC.
- [Dev/prod parity & privilege bootstrap](env-parity-and-privilege-bootstrap.md) — "still broken" after a verified fix usually means the user is on prod; and never allowlist on a locally-stored email.
- [Drizzle schema sync](drizzle-schema-sync.md) — push from schema files is the path (journal drift makes migrate/generate unsafe); non-TTY push prompts fail, so apply narrow ALTERs via SQL directly.
- [Drizzle error wrapping](drizzle-error-cause.md) — constraint details (duplicate key etc.) live on `err.cause`, never `err.message`; classifying on the wrapper message silently never matches.
- [api-zod codegen broken](api-zod-codegen-broken.md) — spec codegen emits zod-v4 syntax the workspace can't compile; revert lib/api-zod and hand-patch it to match the spec.
- [Geography seed joins](seed-positional-joins.md) — match constituencies by name, never position; upserts must update FK links on conflict or stale links survive reseeds.
