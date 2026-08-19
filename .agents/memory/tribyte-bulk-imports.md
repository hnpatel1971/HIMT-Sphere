---
name: TriByte bulk structure imports
description: Safety and reliability rules for importing all TriByte course structures.
---

# TriByte bulk structure imports

**Rule:** Treat a full Course Structure import as a persistent, resumable server-side job. Its default must import only courses without an existing LMS structure; replacing an existing structure requires an explicit administrator choice.

**Why:** Course structures may have been manually renamed, reordered, or assigned to faculty in the LMS. A background job avoids browser timeouts across the full catalog, while the safe default prevents a large migration from silently deleting those edits.

**How to apply:** Keep per-course outcome records so failures can be retried alone and progress can survive a page refresh or service restart. Any future bulk migration that can overwrite LMS-authored data should use the same explicit-replacement pattern.

**Rule:** When a cancelled import is resumed, requeue both failed and still-pending course items.

**Why:** Cancellation stops after the current course; treating “retry” as failures only would permanently leave the unstarted portion of the catalog out of the migration.

**How to apply:** Label the action as a resume when pending courses remain, and report the combined unfinished count to the administrator.

**Rule:** An authenticated, course-specific TriByte “Show All Topics” page with no topic cards represents an empty structure, not an import failure.

**Why:** Some legacy courses exist in TriByte without any topics. Their pages load normally but contain no topic-node links to migrate.

**How to apply:** Complete the course with zero imported topics while retaining an explanatory result note. Only flag an error when the page is unauthenticated or otherwise does not match the expected course page.