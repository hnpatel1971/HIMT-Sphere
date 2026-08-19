---
name: Clerk learner auth routing
description: The routing arrangement required for Clerk browser sessions to reach LMS API authorization.
---

Mount the Clerk provider inside the application's Wouter router and supply the router push/replace callbacks using base-path stripping. Keep the API's Clerk middleware ahead of API routes, and use Clerk's server-side user data to establish the local learner mapping.

**Why:** A provider outside the client router rendered sign-in UI but did not maintain the browser's authenticated Clerk state through the path-based LMS application, leaving valid learner requests unauthenticated at the API.

**How to apply:** Preserve this provider/router arrangement whenever learner sign-in routes, the application's base path, or the web artifact routing are changed. Private course resources must continue to check the Clerk identity plus explicit per-course access, rather than trusting a resource URL.