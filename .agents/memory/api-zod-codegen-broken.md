---
name: api-zod codegen emits zod-v4 syntax
description: Running the api-spec codegen breaks lib/api-zod; how to update the API contract safely.
---

Running `pnpm run codegen` in `lib/api-spec` regenerates `lib/api-client-react` correctly, but rewrites `lib/api-zod/src/generated` with zod v4 syntax (`z.looseObject`) while the workspace pins zod 3 — the package then fails typecheck. It also appends duplicate `export *` lines to `lib/api-zod/src/index.ts`.

**Why:** orval's zod client targets zod 4; the workspace hasn't upgraded.

**How to apply:** After editing `openapi.yaml`, run codegen, keep the `api-client-react` output, then `git checkout -- lib/api-zod` and hand-patch the affected `lib/api-zod/src/generated` files (types, `types/index.ts` exports, and the zod response/body schemas in `generated/api.ts`) to match the spec. Completion review checks that api-zod stays in sync with the spec, so don't skip the hand-patch.
