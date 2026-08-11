---
name: Manual trial extension rules
description: Constraints a "give them more trial time" action must satisfy so it cannot silently no-op or shorten a trial.
---

# Manual trial extension

Extending a trial by hand is its own operation, separate from granting a plan
for N months. Four rules, each protecting against a failure that *looks like
success* in the operator UI:

1. **Extend from the later of now or the current expiry.** Extending from
   "now" silently discards whatever time the campaign had left. A lapsed trial
   restarts from today; a live one gets the days added on top.
2. **Refuse when Stripe governs the plan** (subscription `active` or
   `trialing`). The override column is not what grants their access, so writing
   it would report success and change nothing. Fail loud (409).
3. **Restore the paid tier, not just the date.** The expiry cron downgrades
   stored plan to free, so setting only an override leaves the campaign capped
   with a future expiry that grants nothing.
4. **Bound the day count.** Unbounded "extension" is just a free plan with
   extra steps.

**Why:** every one of these was reachable through the obvious implementation
(write `planOverrideUntil = now + days`), and all four fail quietly — the
operator sees a success toast while the campaign stays limited or loses days.

**How to apply:** any future action that hands out time or capacity outside
Stripe (extensions, comps, pilot windows) should be checked against the same
four questions before shipping.
