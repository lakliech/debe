---
name: Stripe webhook raw body ordering
description: The webhook route must be registered before the global JSON body parser.
---

Mount the payment-provider webhook route with a raw-body parser **before** the
application's global JSON parser middleware. Every other route keeps normal JSON parsing.

**Why:** the provider signs the exact raw request bytes. If the global JSON parser runs
first, the body is parsed and re-serialised, key order and whitespace change, and the
signature check fails for every single webhook. The failure looks like a credentials or
secret problem, which sends you debugging the wrong thing entirely.

**How to apply:** this is an ordering constraint in the Express app setup, not in the
router module. Adding the route to the normal router registry is not enough — it has to
be registered on the app ahead of the body-parser line. If webhooks start failing
signature verification after a refactor, check that middleware order first.
