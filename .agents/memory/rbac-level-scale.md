---
name: RBAC level scale and role catalogue ownership
description: The single privilege scale shared by server and client, and why the client must never keep its own slug→level table.
---

# The privilege scale

`roles.level` is the ONLY privilege scale. **Lower = more privileged.** Level 0
is the cross-tenant platform operator, 1 the most privileged tenant role, 10 the
least. A sentinel well above the range means "no roles at all" and is never
stored. Guards therefore compare `level <= N`, never `>=`.

## Rule: the client must not own a role catalogue

UI privilege gates consume the level the server sends with each role and take
the **minimum** across the user's roles. Never a hardcoded client-side
slug→level map.

**Why:** a duplicated frontend catalogue drifted from the seeds on two axes at
once — inverted level numbers *and* slugs that never matched the seeded
spelling. Unmatched slugs fell back to the bottom of the client's scale, so the
most privileged roles resolved to the least privileged value and silently lost
whole sections. Two mutually wrong scales typecheck perfectly; only the runtime
symptom reveals it.

**How to apply:** read the level off the API response. If an endpoint doesn't
send one, add it there rather than inferring from the slug. A missing or unknown
level must degrade to least-privileged — a lookup miss must never *grant*
privilege.

## Gate on remit, not just level

Unrelated roles share a level (legal, data-protection, audit and security sit
together with no finance duties). A bare `level <= N` hands out sections by
accident. Gate functional areas on a role "family" and reserve level comparisons
for genuine seniority overrides.

## Role slugs are an unchecked contract

The seed file is authoritative for slug spelling. Slugs referenced anywhere else
are bare string literals, so a typo yields a guard that silently admits nobody
rather than a compile error.

**Why:** such a guard fails *open-looking but closed* — it appears to delegate
authority while granting it to nobody, and the omission stays invisible because
the most privileged role bypasses role checks entirely and never hits the wall.

**How to apply:** audit by set-differencing guard literals against the seeds,
not by exercising the app as an admin. Prefer reconciling a wrong slug over
adding a twin role: near-synonyms drift, and then whichever name an operator
picks from the role list decides whether a permission works. Treat the markdown
role docs as prose — they are a third catalogue and already stale.

## Two names that look alike but are not

The tenant "super admin" is a mid-tier role granted to every self-serve founder.
The cross-tenant platform operator is a *different* role at the top level. Never
let the tenant super-admin slug satisfy a platform-level guard, or any founder
can administer every other tenant.
