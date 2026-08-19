---
name: Bundled session-store assets
description: Prevent the API bundle from breaking administrator sessions after a production-style rebuild.
---

# Bundled session-store assets

`connect-pg-simple` dynamically reads its `table.sql` schema file from the directory beside the running module when it creates the session table. The API uses a bundled `dist` entry point, so that asset must be copied into the output during every build.

**Why:** The dependency can otherwise work in source development but fail after a clean bundled build, causing administrator login to return a server error before any session can be established.

**How to apply:** When changing the API bundling strategy or session-store dependency, retain runtime-loaded non-JavaScript assets in `dist` and verify an administrator login works after a clean restart.