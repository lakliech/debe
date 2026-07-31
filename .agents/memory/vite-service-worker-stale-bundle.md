---
name: Service worker masks dev changes
description: A cached bundle can survive HMR and make a correct fix look broken.
---

The web frontend registers a service worker for offline field use. In development this
means a cached bundle can survive an HMR update, so a screenshot or preview may render
**old code** even though the dev server logged the update and the file on disk is correct.

**Why:** this was hit while fixing a page stuck on a loading spinner. The fix was correct
and had compiled, HMR had fired, but repeated screenshots kept showing the old behaviour
and the old network requests — which made the fix look wrong and invited a second,
unnecessary round of debugging.

**How to apply:** when a dev-server change appears not to take effect, rule out staleness
*before* re-reading the code. Load the route with a cache-busting query param, or hard
reload. If the behaviour changes, it was the cache, not the fix.
