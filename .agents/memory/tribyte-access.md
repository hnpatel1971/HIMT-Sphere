---
name: TriByte admin access & scraping
description: How TriByte LMS is structured, login approach, and what each course button does — from live inspection.
---

# TriByte Admin Access

**URL:** https://admin.learn.himtelearning.com  
**Login path:** POST `/user/login?destination=...`  
**Form fields:** `name`, `pass`, `form_build_id`, `form_id`, `op=Log in`  
**Session cookies set on login:** SESS*, lid, lrole, lname, ts, ln, mac

**Platform:** Drupal-based CMS (not a REST API — server-rendered HTML)

## Key pages
- Course list: `/reviewer/course/list` (paginated, 6 pages, 95 courses total)
- Topics: `/reviewer/topics?cat={tid}&catspec=true`
- Edit course: `/node/{nid}/edit/course`
- Generate concepts: `/generate/adaptiveconcept?cat_tid={tid}`
- Curriculum nav: `/reviewer/curriculum`

## Real course data
- 95 courses extracted from TriByte and imported into `curriculum_courses` table
- Each course has `tribyteNid` (node ID) and `tribyteTid` (taxonomy/category ID)
- Thumbnails served from `https://static.learn.himtelearning.com/...`

## Course card buttons (exact TriByte mapping)
1. **Edit** → `/node/{nid}/edit/course` — Drupal node edit form
2. **Generate Concepts** → `/generate/adaptiveconcept?cat_tid={tid}`
3. **Progress** → dropdown with 4 items (all load via `/reviewer/load/frame?...`):
   - Course Progress: `/apps/dashboard/coursesummary?tid={tid}&group={gid}`
   - Quiz Progress: `/apps/dashboard/groupassessments?course_tid={tid}`
   - Activity Progress: `/apps/dashboard/groupassignments?course_tid={tid}`
   - Classroom Progress: `/apps/classroomattendance/?course_tid={tid}`
4. **Course Structure** → `/reviewer/topics?cat={tid}&catspec=true` (topic carousel with sub-actions)
5. **DASH Actions** → dropdown (most items disabled AI features + Enable DASH + Download Files List + Find Matching Documents + Show All Questions)
6. **Others** → dropdown: Upload TOC (`/reviewer/createresource?course_nid={nid}`) + Delete

## Sync mechanism
`syncTriByteCourses()` runs on API server startup — checks if any curriculum_courses have a non-empty `tribyte_nid`, and if not, deletes all placeholder rows and inserts the 95 real ones. Only runs once.

**Why:** Seed guard (`if (existing.length > 0) return`) prevented re-seeding since the `courses` table was already populated.

## Topic import quirks

**Rule:** Preserve the session cookie created by the initial Drupal login-page GET when submitting the login form, then carry the returned cookies to each authenticated request.

**Why:** TriByte's login page currently has an `id` attribute between the `form_build_id` field's `name` and `value` attributes, and Drupal ties its form token to the session created by the initial GET. A strict attribute-order parser or a POST without that cookie silently prevents authenticated scraping.

**How to apply:** Parse the entire hidden input tag for `form_build_id`, not a fixed attribute sequence. On `/reviewer/topics`, obtain topic node IDs from the ordered `/node/{nid}/edit/subtopics` links: the current carousel exposes no `data-nid` attributes. Fetch `/node/{nid}/edit/topic/tab` to read each actual topic title.

## Course-list scraping quirks

**Rule:** Identify course cards by their `li#category_{nid}` carousel element and extract the course title from `.carousel_title_element`.

**Why:** The authenticated `/reviewer/course/list` page does not use `views-row` cards. It also includes ordinary Drupal forms with `form_build_id`, so those fields alone do not mean the session has been redirected to the login page.

**How to apply:** Treat a page as the login screen only when its title is `User account | HIMT` and it has the `#user-login` form. Keep course scraping resilient to nested list content by finding the matching closing `li` for each carousel card.
