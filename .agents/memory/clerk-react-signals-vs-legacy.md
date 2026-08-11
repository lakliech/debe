---
name: Clerk React signals vs legacy hooks
description: Custom Clerk sign-in flows in this workspace must use the legacy hook subpath, not the package root.
---

`@clerk/react` ships two generations of hooks under the same names. The package
root exports the newer **signals** API; the classic hooks live on the
`@clerk/react/legacy` subpath. Both work against the same provider, and mixing
them in one app is fine.

**Rule:** build custom sign-in flows (ticket exchange, programmatic session
creation) against the legacy subpath. The root hooks do not expose the
create-then-activate shape those flows need.

**Why:** because the two generations share hook names, importing from the wrong
one fails as a wall of confusing type errors about missing properties, which
reads like a broken install or a version mismatch rather than a wrong import
path. It cost a debugging cycle once already.

**How to apply:** the everyday hooks (current user, session state) are fine from
the root — only reach for the legacy subpath when driving sign-in yourself.
