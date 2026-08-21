---
name: Document DRM — page-image rendering
description: Durable security decisions for the protected document rendering pipeline (Task #58).
---

# Document DRM — Page-Image Rendering

## Security decisions

**Raw streaming blocked for all non-media resources.**
Both `/admin-view` and `/open` return 403 for any resource that is not `Video` or `Recording` type when accessed directly. This covers stored files (GCS) and external URLs equally.

**Why:** Sending raw bytes to the browser exposes the source file and bypasses the watermark pipeline entirely. The only safe path for documents is the page-image endpoints.

**How to apply:** Any new resource type that is media (streams raw bytes) must be explicitly added alongside `Video` and `Recording` in all four DRM gate checks in `lms.ts`. Document-adjacent types default to blocked.

---

**Admin page-image endpoints require an admin session, not Clerk.**
`/admin-view/page-count` and `/admin-view/page/:n` check `req.session.isAdmin === true`. Clerk identity alone is not sufficient.

**Why:** Admins use a separate session-based login; a Clerk user who is not an admin should not be able to call admin preview endpoints.

---

**Publitas publications are served via server-side redirect, not client JSON.**
The Publitas viewer URL is never returned in any API response. The `/open` (and `/admin-view`) endpoint redirects to the Publitas URL server-side. The page-count endpoint returns `{ externalViewer: "publitas" }` so the frontend knows to render an iframe pointing at the server endpoint rather than trying to page-render the HTML viewer.

**Why:** Returning the Publitas URL in client JSON would allow a determined user to bypass enrollment gating by copying the URL. The server-redirect approach keeps the URL opaque.

**How to apply:** Any future web-publication provider that serves interactive HTML (not a downloadable PDF) should follow the same pattern: exempt from 403, detect in page-count, return `externalViewer` marker, render as iframe in `DocumentPageViewer`.

---

**LibreOffice and Poppler declared as Nix system dependencies — never hard-code store paths.**
`soffice`, `pdftoppm`, and `pdfinfo` are all invoked by binary name (from PATH). LibreOffice is installed via `installSystemDependencies({ packages: ["libreoffice"] })`.

**Why:** Nix store paths contain content-addressed hashes that change on every rebuild or NixOS channel update. Hard-coding a store path causes all non-PDF rendering to fail silently after any environment update.
