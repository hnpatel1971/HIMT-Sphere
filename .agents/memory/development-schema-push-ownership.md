---
name: Development schema push ownership
description: Keep Drizzle development schema updates additive and repeatable when other tools own database objects.
---

Development schema updates must use the ordinary non-destructive Drizzle push path. Database tables owned by another library, such as the PostgreSQL session store, must be excluded from Drizzle's table filter rather than being treated as disposable schema drift.

**Why:** Treating externally owned tables as missing schema makes Drizzle propose deleting live session data. Generated constraint names can also differ from PostgreSQL's stored identifier after its length limit is applied; a supposedly additive push then repeats unnecessary DDL or asks to truncate a populated table.

**How to apply:** When a persistent constraint already exists with the intended semantics, give its Drizzle definition that stable database name. Keep only application-owned tables in Drizzle's diff scope, never use an auto-approving or destructive development push to work around a prompt, and leave production schema changes to Publish.