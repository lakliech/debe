---
name: Gate authenticated queries on auth state
description: An ungated 401 query keeps a page pinned on its loading state.
---

Any page reachable while signed out that queries an authenticated endpoint must gate the
query on the resolved auth state (`enabled`) and disable retry for it.

**Why:** the app's shared query client defaults to retrying once. A signed-out visitor
hits the endpoint, gets a 401, the retry keeps the query in a loading state, and a
component that early-returns on `isLoading` renders its spinner forever — the signed-out
branch below it is never reached. The page looks hung rather than showing its sign-in prompt.

Gate on the identity provider's *loaded* flag as well as its *signed-in* flag. Treating
"not yet loaded" as "signed out" flashes the sign-in prompt at every authenticated user
on first paint.

**How to apply:** for public-reachable pages, the loading gate should depend only on the
auth provider's own loaded state, plus the data query *when signed in*. Never let an
unauthenticated data fetch decide whether the page can render at all.
