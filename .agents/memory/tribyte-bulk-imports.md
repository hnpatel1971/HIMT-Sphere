---
name: TriByte bulk structure imports
description: Safety and reliability rules for importing all TriByte course structures.
---

# TriByte bulk structure imports

**Rule:** Treat a full Course Structure import as a persistent, resumable server-side job. Its default must import only courses without an existing LMS structure; replacing an existing structure requires an explicit administrator choice.

**Why:** Course structures may have been manually renamed, reordered, or assigned to faculty in the LMS. A background job avoids browser timeouts across the full catalog, while the safe default prevents a large migration from silently deleting those edits.

**How to apply:** Keep per-course outcome records so failures can be retried alone and progress can survive a page refresh or service restart. Any future bulk migration that can overwrite LMS-authored data should use the same explicit-replacement pattern.