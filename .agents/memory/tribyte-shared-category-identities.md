---
name: TriByte shared-category identities
description: How to keep separate LMS course structures when TriByte courses share a category.
---

TriByte category and node values are not globally unique course identities. Persist imported topic and sub-topic records with the LMS course identity included, and look up existing records by LMS course plus source node.

**Why:** More than one source course record can point to the same category and therefore expose the same source topic nodes. Category-scoped keys cause one course's import to block another course's otherwise valid structure.

**How to apply:** For each course-specific import or resource scan, treat the course's own ID and the TriByte node together as the stable identity. Preserve legacy rows already associated with that same course; do not reuse another course's rows merely because their category or node matches.