---
name: Protected document schema compatibility
description: Keep protected document delivery isolated from additive video-DRM schema changes.
---

Protected document handlers should query only the stable resource fields needed to authorize and render a document, rather than selecting an entire resource row.

**Why:** A production deployment can be temporarily behind development on additive video/DRM fields. A full resource-row read then fails before the document renderer runs, even though the resource's required document fields and its token authorization are valid.

**How to apply:** For page-count, page-image, and accessible-document handlers, explicitly project the resource identity, course, source, type, MIME type, ready status, and private storage path. Do not weaken token, admin-session, learner-enrollment, or watermark checks as a workaround.