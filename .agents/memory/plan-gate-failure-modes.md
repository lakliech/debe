---
name: Plan gates must fail loud, not open
description: Why capacity/entitlement checks in this codebase must surface their own errors, and the drizzle result-shape trap that made them silently pass.
---

A plan gate that cannot compute current usage must **refuse or log**, never
quietly allow the request.

**Why:** the agent-cap gate shipped with a counting helper whose query threw on
every call. The throw was swallowed by the surrounding try/catch and treated as
"no violation", so the cap was a no-op — a free campaign could add unlimited
agents and nothing in the logs said so. A gate that fails open is worse than no
gate: the product looks enforced while the revenue leak is invisible.

**How to apply:** an entitlement or capacity check that cannot determine the
current usage must refuse the request (a retryable 503 reads honestly — a 402
would tell a campaign to pay for something they may already have) and log the
failure with the tenant id. Never `next()` out of the catch.

Cover each gate with a test that asserts the *refusal*, not just the happy
path: a passing "allowed under the cap" test cannot tell a working gate from a
dead one, which is exactly how the broken gate went unnoticed.
