---
name: Resource-import recovery schema gates
description: Keep startup recovery from querying partially deployed resource-import job schemas.
---

**Rule:** Validate every column read by resumable resource-import job recovery before scheduling its background timers. A missing schema field must fail startup with an actionable error rather than being logged as a skipped recovery attempt.

**Why:** Recovery selects complete import-job rows. An additive schema update that has not reached a database causes the background query to fail after startup, leaving interrupted imports stranded without a clear deployment signal.

**How to apply:** Keep the schema source of truth additive with defaults for summary counters. Apply development changes through the supported database schema flow and production changes through Publish; do not add application-startup DDL as a workaround. Start recovery only after the read-only schema check passes.