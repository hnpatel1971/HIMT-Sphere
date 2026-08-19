import { pgTable, text, integer, bigint, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

// ─── Curriculum management ────────────────────────────────────────────────────

export const groups = pgTable("groups", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  parentId:  text("parent_id"),           // self-ref for tree (no FK cycle in Drizzle)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  groupName:    text("group_name").default(""),
  status:       text("status").default("Active"),
  lastActivity: text("last_activity").default("Never"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const learnerIdentities = pgTable("learner_identities", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email:       text("email").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});

export const learnerCourseAccess = pgTable("learner_course_access", {
  id:          text("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().references(() => learnerIdentities.clerkUserId, { onDelete: "cascade" }),
  courseId:    text("course_id").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

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
  jobId:             text("job_id").notNull().references(() => courseStructureImportJobs.id, { onDelete: "cascade" }),
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
});

// ─── TriByte learning resources & resource-import jobs ────────────────────────

export const courseResources = pgTable("course_resources", {
  id:              text("id").primaryKey(),
  courseId:        text("course_id").notNull(),       // curriculum_courses.id
  topicId:         text("topic_id"),                   // course_topics.id, when attached to a topic
  subtopicId:      text("subtopic_id"),                // course_subtopics.id, when attached to a sub-topic
  sourceNid:       text("source_nid").default(""),     // TriByte node containing the resource
  sourceIdentity:  text("source_identity").notNull().unique(),
  sourceUrl:       text("source_url").notNull(),
  title:           text("title").notNull(),
  resourceType:    text("resource_type").notNull().default("Learning resource"),
  mimeType:        text("mime_type").default(""),
  fileName:        text("file_name").default(""),
  // Training recordings can exceed PostgreSQL's 2 GB integer limit.
  sizeBytes:       bigint("size_bytes", { mode: "number" }),
  order:           integer("order").default(0),
  status:          text("status").notNull().default("pending"), // pending | ready | failed | unsupported
  storagePath:     text("storage_path"),               // /objects/… path in App Storage
  checksum:        text("checksum"),
  error:           text("error"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

export const courseResourceImportJobs = pgTable("course_resource_import_jobs", {
  id:                text("id").primaryKey(),
  status:            text("status").notNull().default("queued"),
  totalCourses:      integer("total_courses").notNull().default(0),
  completedCourses:  integer("completed_courses").notNull().default(0),
  importedResources: integer("imported_resources").notNull().default(0),
  failedResources:   integer("failed_resources").notNull().default(0),
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
  jobId:              text("job_id").notNull().references(() => courseResourceImportJobs.id, { onDelete: "cascade" }),
  courseId:           text("course_id").notNull(),
  courseName:         text("course_name").notNull(),
  status:             text("status").notNull().default("pending"),
  discoveredResources:integer("discovered_resources").notNull().default(0),
  importedResources:  integer("imported_resources").notNull().default(0),
  failedResources:    integer("failed_resources").notNull().default(0),
  error:              text("error"),
  attempts:           integer("attempts").notNull().default(0),
  startedAt:          timestamp("started_at"),
  finishedAt:         timestamp("finished_at"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
});

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
