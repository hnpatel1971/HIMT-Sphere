import { sql } from "drizzle-orm";
import { pgTable, text, integer, bigint, boolean, timestamp, jsonb, foreignKey, uniqueIndex } from "drizzle-orm/pg-core";

// ─── Curriculum management ────────────────────────────────────────────────────

export const groups = pgTable("groups", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  parentId:  text("parent_id"),           // self-ref for tree (no FK cycle in Drizzle)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("groups_name_lower_unique").on(sql`lower(${table.name})`),
]);

export const curriculumCourses = pgTable("curriculum_courses", {
  id:               text("id").primaryKey(),
  name:             text("name").notNull(),
  groupName:        text("group_name").default("All Content"),
  language:         text("language").default("English").notNull(),
  adaptiveUserName: text("adaptive_user_name").default(""),
  status:           text("status").default("Published").notNull(),
  appliedTags:      jsonb("applied_tags").default([]),
  tribyteNid:       text("tribyte_nid").default(""),   // TriByte node ID (for iframe URLs)
  tribyteTid:       text("tribyte_tid").default(""),   // TriByte taxonomy ID
  thumbUrl:         text("thumb_url").default(""),     // course thumbnail from TriByte
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});

export const tags = pgTable("tags", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const glossaryTerms = pgTable("glossary_terms", {
  id:         text("id").primaryKey(),
  title:      text("title").notNull(),
  definition: text("definition").default(""),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

export const uploadJobs = pgTable("upload_jobs", {
  id:              text("id").primaryKey(),
  video:           text("video").notNull(),
  type:            text("type").default("Video"),
  uploadedBy:      text("uploaded_by").default("Admin"),
  uploadStatus:    text("upload_status").default("Pending"),
  transcodeStatus: text("transcode_status").default("Pending"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

export const faqCategories = pgTable("faq_categories", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull(),
  email:        text("email").notNull().unique(),
  role:         text("role").default("student"),   // admin | faculty | student
  groupId:      text("group_id").references(() => groups.id, { onDelete: "set null" }),
  groupName:    text("group_name").default(""),
  status:       text("status").default("Active"),
  lastActivity: text("last_activity").default("Never"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
]);

export const learnerIdentities = pgTable("learner_identities", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email:       text("email").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("learner_identities_user_id_unique").on(table.userId),
]);

export const learnerCourseAccess = pgTable("learner_course_access", {
  id:          text("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  courseId:    text("course_id").notNull(),
  expiresAt:   timestamp("expires_at"),    // DRM-006: null = no expiry; set to restrict time-limited access
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("learner_course_access_identity_course_unique").on(table.clerkUserId, table.courseId),
  foreignKey({
    columns: [table.clerkUserId],
    foreignColumns: [learnerIdentities.clerkUserId],
    name: "learner_course_access_clerk_user_id_learner_identities_clerk_us",
  }).onDelete("cascade"),
]);

/** Admin-managed course assignments. These exist before a learner's first Clerk sign-in. */
export const userCourseEnrollments = pgTable("user_course_enrollments", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId:  text("course_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("user_course_enrollments_user_course_unique").on(table.userId, table.courseId),
]);

/** Durable summary for each user roster import. Raw credentials and source files are never stored. */
export const userImportRuns = pgTable("user_import_runs", {
  id:        text("id").primaryKey(),
  source:    text("source").notNull(),
  filename:  text("filename").notNull(),
  total:     integer("total").notNull(),
  added:     integer("added").notNull(),
  updated:   integer("updated").notNull(),
  failed:    integer("failed").notNull(),
  warnings:  jsonb("warnings").default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── DRM access audit ─────────────────────────────────────────────────────────

/** One row per protected content request — success or failure — for compliance audit. */
export const contentAccessLogs = pgTable("content_access_logs", {
  id:            text("id").primaryKey(),
  userId:        text("user_id"),           // Clerk user ID; null for admin-session requests
  resourceId:    text("resource_id").notNull(),
  courseId:      text("course_id").notNull(),
  /** view_attempt | view_success | view_denied | view_error */
  action:        text("action").notNull(),
  sessionId:     text("session_id"),
  userAgent:     text("user_agent"),
  ipAddress:     text("ip_address"),
  outcomeDetail: text("outcome_detail"),
  pageNumber:    integer("page_number"),
  activityId:    text("activity_id"),
  deviceContext: jsonb("device_context"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

// ─── DRM content tokens ───────────────────────────────────────────────────────

/**
 * Short-lived (60 s), one-time-use tokens that gate every protected content request (DRM-003).
 * Issued by POST /curriculum/resources/:id/token; consumed on first delivery endpoint call.
 */
export const contentTokens = pgTable("content_tokens", {
  id:         text("id").primaryKey(),         // crypto-random hex (64 chars)
  userId:     text("user_id"),                  // Clerk user ID; null for admin-session callers
  sessionId:  text("session_id").notNull(),     // bound to the session that issued the token
  viewerSessionId: text("viewer_session_id"),
  resourceId: text("resource_id").notNull(),
  expiresAt:  timestamp("expires_at").notNull(),
  usedAt:     timestamp("used_at"),             // null until consumed; never reusable after set
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

/** Short-lived protected viewer sessions. HLS manifests, keys, and segments are
 * all checked against this record so revocation is effective mid-playback. */
export const protectedViewerSessions = pgTable("protected_viewer_sessions", {
  id:                text("id").primaryKey(),
  userId:            text("user_id"),
  sessionId:         text("session_id").notNull(),
  resourceId:        text("resource_id").notNull(),
  expiresAt:         timestamp("expires_at").notNull(),
  revokedAt:         timestamp("revoked_at"),
  accessibilityMode: boolean("accessibility_mode").notNull().default(false),
  watermarkConfig:   jsonb("watermark_config").default({}),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  lastSeenAt:        timestamp("last_seen_at").defaultNow().notNull(),
});

/** Durable learner playback state; opening a player is not completion. */
export const protectedPlaybackProgress = pgTable("protected_playback_progress", {
  id:              text("id").primaryKey(),
  userId:          text("user_id").notNull(),
  resourceId:      text("resource_id").notNull(),
  courseId:        text("course_id").notNull(),
  viewerSessionId: text("viewer_session_id"),
  positionSeconds: integer("position_seconds").notNull().default(0),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  playbackRate:   text("playback_rate").notNull().default("1"),
  captionsEnabled: boolean("captions_enabled").notNull().default(false),
  completed:       boolean("completed").notNull().default(false),
  completedAt:     timestamp("completed_at"),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("protected_playback_progress_user_resource_unique").on(table.userId, table.resourceId),
]);

// ─── Learner-facing courses ───────────────────────────────────────────────────

export const courses = pgTable("courses", {
  id:           text("id").primaryKey(),
  code:         text("code").notNull(),
  name:         text("name").notNull(),
  category:     text("category").default(""),
  language:     text("language").default("English"),
  status:       text("status").default("Draft"),
  progress:     integer("progress").default(0),
  learners:     integer("learners").default(0),
  duration:     text("duration").default(""),
  thumbnail:    text("thumbnail").default(""),
  nextActivity: text("next_activity"),
  accent:       text("accent").default("ocean"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const assignments = pgTable("assignments", {
  id:        text("id").primaryKey(),
  title:     text("title").notNull(),
  course:    text("course").notNull(),
  dueDate:   text("due_date").notNull(),
  status:    text("status").default("Draft"),
  submitted: boolean("submitted").default(false),
  assessor:  text("assessor").default(""),
  priority:  text("priority").default("normal"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const announcements = pgTable("announcements", {
  id:          text("id").primaryKey(),
  title:       text("title").notNull(),
  body:        text("body").default(""),
  audience:    text("audience").default("All"),
  publishedAt: text("published_at").notNull(),
  unread:      boolean("unread").default(true),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id:         text("id").primaryKey(),
  title:      text("title").notNull(),
  course:     text("course").notNull(),
  type:       text("type").default("Webinar"),
  date:       text("date").notNull(),
  time:       text("time").notNull(),
  location:   text("location").default(""),
  faculty:    text("faculty").default(""),
  attendance: text("attendance").default("Not marked"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

export const certificates = pgTable("certificates", {
  id:        text("id").primaryKey(),
  title:     text("title").notNull(),
  course:    text("course").notNull(),
  issuedOn:  text("issued_on").notNull(),
  expiresOn: text("expires_on"),
  status:    text("status").default("Verified"),
  serial:    text("serial").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── OBE / Academic structure ─────────────────────────────────────────────────

export const programmes = pgTable("programmes", {
  id:               text("id").primaryKey(),
  name:             text("name").notNull(),
  code:             text("code").notNull().unique(),
  department:       text("department").default(""),
  durationText:     text("duration_text").default(""),
  totalCourses:     integer("total_courses").default(0),
  publishedCourses: integer("published_courses").default(0),
  totalLearners:    integer("total_learners").default(0),
  status:           text("status").default("Active"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});

export const programmeCourses = pgTable("programme_courses", {
  id:             text("id").primaryKey(),
  programmeId:    text("programme_id").notNull().references(() => programmes.id, { onDelete: "cascade" }),
  name:           text("name").notNull(),
  code:           text("code").notNull(),
  semester:       integer("semester").notNull(),
  credits:        integer("credits").default(3),
  type:           text("type").default("Core"),   // Core | Elective | Lab
  status:         text("status").default("Draft"),
  outcomesCount:  integer("outcomes_count").default(0),
  modulesCount:   integer("modules_count").default(0),
  activitiesCount:integer("activities_count").default(0),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

// Course outcomes stored flat; modules/topics/activities stored as JSONB
// (normalising 4 levels deep adds complexity without benefit at this stage)
export const courseOutlines = pgTable("course_outlines", {
  id:                text("id").primaryKey(),
  programmeCourseId: text("programme_course_id").notNull()
                       .references(() => programmeCourses.id, { onDelete: "cascade" }),
  description:       text("description").default(""),
  outcomes:          jsonb("outcomes").default([]),   // CourseOutcome[]
  modules:           jsonb("modules").default([]),    // Module[]
  createdAt:         timestamp("created_at").defaultNow().notNull(),
});

// ─── Course topics & sub-topics (curriculum) ─────────────────────────────────

export const courseTopics = pgTable("course_topics", {
  id:        text("id").primaryKey(),
  courseId:  text("course_id").notNull(),   // curriculum_courses.id
  nid:       text("nid").default(""),       // TriByte topic node ID
  tid:       text("tid").default(""),       // TriByte topic taxonomy ID
  name:      text("name").notNull(),
  order:     integer("order").default(0),
  thumbUrl:  text("thumb_url").default(""),
  faculty:   text("faculty").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const courseSubtopics = pgTable("course_subtopics", {
  id:       text("id").primaryKey(),
  topicId:  text("topic_id").notNull(),     // course_topics.id
  courseId: text("course_id").notNull(),    // denorm for fast query
  nid:      text("nid").default(""),
  name:     text("name").notNull(),
  order:    integer("order").default(0),
  createdAt:timestamp("created_at").defaultNow().notNull(),
});

// ─── Bulk TriByte course-structure imports ───────────────────────────────────

export const courseStructureImportJobs = pgTable("course_structure_import_jobs", {
  id:                text("id").primaryKey(),
  status:            text("status").notNull().default("queued"),
  replaceExisting:   boolean("replace_existing").notNull().default(false),
  totalCourses:      integer("total_courses").notNull().default(0),
  completedCourses:  integer("completed_courses").notNull().default(0),
  importedCourses:   integer("imported_courses").notNull().default(0),
  skippedCourses:    integer("skipped_courses").notNull().default(0),
  failedCourses:     integer("failed_courses").notNull().default(0),
  currentCourseId:   text("current_course_id"),
  currentCourseName: text("current_course_name"),
  cancelRequested:   boolean("cancel_requested").notNull().default(false),
  startedAt:         timestamp("started_at"),
  finishedAt:        timestamp("finished_at"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});

export const courseStructureImportJobItems = pgTable("course_structure_import_job_items", {
  id:                text("id").primaryKey(),
  jobId:             text("job_id").notNull(),
  courseId:          text("course_id").notNull(),
  courseName:        text("course_name").notNull(),
  status:            text("status").notNull().default("pending"),
  importedTopics:    integer("imported_topics").notNull().default(0),
  importedSubtopics: integer("imported_subtopics").notNull().default(0),
  error:             text("error"),
  attempts:          integer("attempts").notNull().default(0),
  startedAt:         timestamp("started_at"),
  finishedAt:        timestamp("finished_at"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.jobId],
    foreignColumns: [courseStructureImportJobs.id],
    name: "course_structure_import_job_items_job_id_course_structure_impor",
  }).onDelete("cascade"),
]);

// ─── TriByte learning resources & resource-import jobs ────────────────────────

export const courseResources = pgTable("course_resources", {
  id:              text("id").primaryKey(),
  courseId:        text("course_id").notNull(),       // curriculum_courses.id
  topicId:         text("topic_id"),                   // course_topics.id, when attached to a topic
  subtopicId:      text("subtopic_id"),                // course_subtopics.id, when attached to a sub-topic
  sourceNid:       text("source_nid").default(""),     // TriByte node containing the resource
  sourceIdentity:  text("source_identity").notNull(),
  sourceUrl:       text("source_url").notNull(),
  title:           text("title").notNull(),
  resourceType:    text("resource_type").notNull().default("Learning resource"),
  mimeType:        text("mime_type").default(""),
  fileName:        text("file_name").default(""),
  // Training recordings can exceed PostgreSQL's 2 GB integer limit.
  sizeBytes:       bigint("size_bytes", { mode: "number" }),
  order:           integer("order").default(0),
  status:          text("status").notNull().default("pending"), // pending | ready | failed | unavailable | unsupported
  storagePath:     text("storage_path"),               // /objects/… path in App Storage
  checksum:        text("checksum"),
  recoveryMethod:  text("recovery_method"),            // download | preview_hls | external_reference | storage_resume
  captionsUrl:     text("captions_url"),               // managed, signed caption asset when available
  transcript:      text("transcript"),                 // approved accessible transcript
  drmProvider:     text("drm_provider"),               // e.g. mux | buyDRM; no credentials are stored here
  drmAssetId:      text("drm_asset_id"),
  drmPlaybackId:   text("drm_playback_id"),            // Mux protected playback ID; signed or DRM, never a source-file URL
  drmStatus:       text("drm_status").default("unprovisioned"),
  drmError:        text("drm_error"),                  // safe provisioning status; provider credentials are never stored
  drmUpdatedAt:    timestamp("drm_updated_at"),
  error:           text("error"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Keep the name used by the existing populated development table. Using
  // .unique() here makes Drizzle see a new constraint and offer truncation.
  uniqueIndex("course_resources_source_identity_key").on(table.sourceIdentity),
]);

export const courseResourceImportJobs = pgTable("course_resource_import_jobs", {
  id:                text("id").primaryKey(),
  status:            text("status").notNull().default("queued"),
  totalCourses:      integer("total_courses").notNull().default(0),
  completedCourses:  integer("completed_courses").notNull().default(0),
  importedResources: integer("imported_resources").notNull().default(0),
  failedResources:   integer("failed_resources").notNull().default(0),
  unavailableResources: integer("unavailable_resources").notNull().default(0),
  currentCourseId:   text("current_course_id"),
  currentCourseName: text("current_course_name"),
  cancelRequested:   boolean("cancel_requested").notNull().default(false),
  startedAt:         timestamp("started_at"),
  finishedAt:        timestamp("finished_at"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});

export const courseResourceImportJobItems = pgTable("course_resource_import_job_items", {
  id:                 text("id").primaryKey(),
  jobId:              text("job_id").notNull(),
  courseId:           text("course_id").notNull(),
  courseName:         text("course_name").notNull(),
  status:             text("status").notNull().default("pending"),
  discoveredResources:integer("discovered_resources").notNull().default(0),
  importedResources:  integer("imported_resources").notNull().default(0),
  failedResources:    integer("failed_resources").notNull().default(0),
  unavailableResources: integer("unavailable_resources").notNull().default(0),
  error:              text("error"),
  attempts:           integer("attempts").notNull().default(0),
  startedAt:          timestamp("started_at"),
  finishedAt:         timestamp("finished_at"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.jobId],
    foreignColumns: [courseResourceImportJobs.id],
    name: "course_resource_import_job_items_job_id_course_resource_import_",
  }).onDelete("cascade"),
]);

// ─── Application settings (key-value store) ──────────────────────────────────

export const appSettings = pgTable("app_settings", {
  key:       text("key").primaryKey(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Inferred types (used by API routes) ─────────────────────────────────────

export type Group             = typeof groups.$inferSelect;
export type InsertGroup       = typeof groups.$inferInsert;

export type CurriculumCourse  = typeof curriculumCourses.$inferSelect;
export type InsertCurriculumCourse = typeof curriculumCourses.$inferInsert;

export type Tag               = typeof tags.$inferSelect;
export type InsertTag         = typeof tags.$inferInsert;

export type GlossaryTerm      = typeof glossaryTerms.$inferSelect;
export type InsertGlossaryTerm = typeof glossaryTerms.$inferInsert;

export type UploadJob         = typeof uploadJobs.$inferSelect;
export type InsertUploadJob   = typeof uploadJobs.$inferInsert;

export type FaqCategory       = typeof faqCategories.$inferSelect;
export type InsertFaqCategory = typeof faqCategories.$inferInsert;

export type User              = typeof users.$inferSelect;
export type InsertUser        = typeof users.$inferInsert;
export type UserCourseEnrollment = typeof userCourseEnrollments.$inferSelect;
export type UserImportRun = typeof userImportRuns.$inferSelect;

export type Course            = typeof courses.$inferSelect;
export type InsertCourse      = typeof courses.$inferInsert;

export type Assignment        = typeof assignments.$inferSelect;
export type InsertAssignment  = typeof assignments.$inferInsert;

export type Announcement      = typeof announcements.$inferSelect;
export type InsertAnnouncement = typeof announcements.$inferInsert;

export type Session           = typeof sessions.$inferSelect;
export type InsertSession     = typeof sessions.$inferInsert;

export type Certificate       = typeof certificates.$inferSelect;
export type InsertCertificate = typeof certificates.$inferInsert;

export type Programme         = typeof programmes.$inferSelect;
export type InsertProgramme   = typeof programmes.$inferInsert;

export type ProgrammeCourse   = typeof programmeCourses.$inferSelect;
export type InsertProgrammeCourse = typeof programmeCourses.$inferInsert;

export type CourseOutline     = typeof courseOutlines.$inferSelect;
export type InsertCourseOutline = typeof courseOutlines.$inferInsert;

export type CourseTopic       = typeof courseTopics.$inferSelect;
export type InsertCourseTopic = typeof courseTopics.$inferInsert;

export type CourseSubtopic       = typeof courseSubtopics.$inferSelect;
export type InsertCourseSubtopic = typeof courseSubtopics.$inferInsert;

export type CourseStructureImportJob = typeof courseStructureImportJobs.$inferSelect;
export type CourseStructureImportJobItem = typeof courseStructureImportJobItems.$inferSelect;
export type CourseResource = typeof courseResources.$inferSelect;
export type CourseResourceImportJob = typeof courseResourceImportJobs.$inferSelect;
export type CourseResourceImportJobItem = typeof courseResourceImportJobItems.$inferSelect;
export type ProtectedViewerSession = typeof protectedViewerSessions.$inferSelect;
export type ProtectedPlaybackProgress = typeof protectedPlaybackProgress.$inferSelect;
