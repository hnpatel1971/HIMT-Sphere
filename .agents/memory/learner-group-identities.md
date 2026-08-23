---
name: Learner group identities
description: Durable group memberships, legacy-label reconciliation, and deletion safety.
---

Learner group membership must be identified by the group record ID, not by a copied
group name. Keep a legacy display label only for backwards compatibility while older
records are reconciled.

**Why:** Group names may be edited, deleted, or later reused. Treating a copied label
as a permanent association can silently assign former learners to a newly created
group with the same name.

**How to apply:** Imports and manual edits should resolve a group ID and preserve a
canonical display name. Count membership by ID; use case-insensitive label matching
only for unreconciled legacy rows. When deleting a group, clear both the ID and
legacy label for its members atomically, including legacy name-only rows.

**Upgrade safety:** Add the column and foreign key through the idempotent LMS startup
upgrade path as well as the declarative schema.

**Why:** Existing LMS databases may predate a schema field. A schema-only change
causes startup reconciliation and all group queries to fail before they can repair
legacy memberships.

**How to apply:** Any new database field used by startup code must be available
before the server accepts requests, with an idempotent upgrade suitable for existing
installations.