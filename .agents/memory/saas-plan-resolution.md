---
name: Effective plan vs stored plan
description: Why the tenant plan column is not the granted plan, and what to call instead.
---

Never read the tenant's stored `plan` column to decide what a campaign is entitled to.
Resolve entitlement through the single effective-plan resolver in the API server's plans lib.

Resolution order:
1. An active or trialing payment-provider subscription grants the stored plan.
2. Otherwise, an unexpired plan-override expiry grants the stored plan.
3. Otherwise, the free tier.

**Why:** the stored column records what was *bought or granted*, not what is *currently
active*. Trials and manual platform-admin grants are both expressed as an override
expiry rather than as separate states, so reading the column directly grants paid
features to lapsed trials and to expired comp accounts. Expressing manual grants the
same way as trials also means a deal that was never renewed expires predictably instead
of silently living forever.

A past-due subscription extends the override by a short grace window rather than cutting
access immediately — cutting a campaign off mid-election over a card failure is worse
than carrying them for a few days.

**How to apply:** any feature gate, capacity check, or UI that shows a plan must go
through the resolver. If you find yourself selecting the plan column in a query for
anything other than displaying "what they signed up for", it is a bug.
