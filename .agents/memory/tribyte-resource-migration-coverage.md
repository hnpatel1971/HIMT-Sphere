---
name: TriByte resource migration coverage
description: Prerequisites and source views required for an accurate TriByte learning-resource scan.
---

Run the full course-structure migration before a resource migration so every available topic and sub-topic node can be inspected. Resource discovery must include authenticated content-management views as well as learner-facing node pages, while excluding Drupal navigation/category links from asset candidates.

**Why:** Course landing pages alone do not expose the complete teaching structure, and labels such as “Online class video” can link to taxonomy navigation rather than a playable recording or downloadable file.

**How to apply:** Before reporting a full-catalogue asset migration result, confirm that the structure job completed and scan each imported topic’s learner, content, metadata, and sub-topic views. Treat a zero-resource result as a verified source-coverage finding, not a transfer failure.