---
name: OpenAPI numeric compatibility
description: Compatibility note for generated Zod schemas in this workspace.
---

OpenAPI `integer` fields currently generate `zod.int()` helpers, and `format: email` fields generate `zod.email()` helpers, neither of which are available in the workspace's installed Zod runtime. Use compatible numeric/string OpenAPI fields for generated contracts unless the Zod/Orval versions are upgraded together.

**Why:** The first LMS contract generated correctly but failed the workspace typecheck because the generated validator targeted a newer Zod API than the installed package.

**How to apply:** When adding generated API fields, prefer `type: number` for counts, percentages and IDs that are represented numerically, omit `format: email` while retaining server-side email validation, then regenerate and run the library typecheck.