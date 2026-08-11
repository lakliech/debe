---
name: Provider-owned persisted state
description: Why a child must never seed a context provider's state by writing to the storage key behind it.
---

When a React provider loads persisted state once (a `useState` initializer) and
writes it back whenever it changes, that provider **owns** the storage key. A
descendant that tries to influence the provider by writing the same key is
racing it — and loses. Effects run child-first, so the child's write lands, then
the provider's own mount-time write puts the already-loaded value straight back
over the top. Nothing errors; the child's intent just evaporates.

**Rule:** to influence provider state from a child, call a function the provider
exposes on its context. Reserve the storage key for the provider itself.

**Why:** this exact shape cost a debugging round on the guided demo tour. The
launch screen "armed" the tour through localStorage and the provider silently
clobbered it, so the tour never opened by itself — while a direct reload looked
fine, because then the provider read the armed value during its own init. The
bug only appears on the in-app path, which is the path nobody reloads.

**How to apply:** watch for it whenever a provider both hydrates from and
persists to storage. The tell is a child importing a bare `writeX()` helper
rather than a context method. Prefer the context call even when the storage
write appears to work — a reload masking the race is what makes this expensive
to find later.
