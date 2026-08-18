---
name: LMS DB Architecture
description: Key decisions for the HIMT LMS database and API layer.
---

# LMS DB architecture

## What was built
- 14-table Drizzle schema in `lib/db/src/schema/index.ts`, pushed via `pnpm --filter @workspace/db run push`
- Seed function in `artifacts/api-server/src/routes/lms.ts` runs on server start, checks `courses` table, and inserts all HIMT data if empty (idempotent via `onConflictDoNothing`)
- All learner-facing routes (courses, assignments, sessions, certificates, announcements, users, programmes, outlines) now query Drizzle instead of in-memory arrays
- Curriculum admin pages (courses, tags, glossary, upload-status, faq-categories) all call `/api/curriculum/*` endpoints from the frontend via a `useApi` hook and `apiFetch` helper added at the top of `artifacts/himt-lms/src/App.tsx`

**Why:** Started as in-memory arrays; moved to DB so data survives server restarts and enables real create/delete operations.

## Field name gotcha
The `curriculum_courses` table uses `groupName` (not `group`, which is a reserved SQL word). The frontend maps `groupName → group` at the call site rather than renaming the type.

## Upload timestamps
The `upload_jobs` table uses Drizzle's default `timestamp` (ISO 8601). The frontend renders `createdAt`/`updatedAt` (not `createdDate`/`updatedDate` — avoid that mistake).

## Seed scope
Only `courses`, `assignments`, announcements, sessions, certificates, users, programmes, programme_courses, course_outlines, curriculum_courses, groups, tags, glossary_terms, upload_jobs are seeded. `faq_categories` start empty (correct — empty-state page).

## How to apply
- Adding new tables: update schema → run `pnpm --filter @workspace/db run push` → add seed rows → add routes in `lms.ts`
- Frontend API calls use `useApi<T>(path)` for reads and `apiFetch(path, method, body)` for writes — both defined near the top of `App.tsx`
