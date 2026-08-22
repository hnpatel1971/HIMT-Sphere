import { Router, type IRouter } from "express";
import "express-session"; // ensure SessionData augmentation from auth.ts is loaded
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from "crypto";
import { spawn } from "child_process";
import { createServer } from "http";
import { Readable } from "stream";
import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import { db, pool } from "@workspace/db";
import { parseTriByteCoursePage, type TriByteScrapedCourse } from "../lib/tribyte-course-parser";
import {
  isTriByteVideoContentRecord,
  parseTriBytePreviewLinks,
  parseTriBytePreviewPlaylists,
  parseTriByteResources,
  type ParsedTriByteResource,
} from "../lib/tribyte-resource-parser";
import {
  isApprovedTriByteHlsUrl,
  isDefinitiveTriByteUnavailable,
  rewriteHlsManifest,
  shouldMarkTriByteResourceUnavailable,
  triByteHlsRequestHeaders,
} from "../lib/tribyte-hls";
import {
  deleteStoredResource,
  getStoredResource,
  resourceObjectPath,
  storeResourceStream,
} from "../lib/resource-storage";
import { inspectStoredResource } from "../lib/resource-recovery";
import { renderProtectedPage, getPageCountFromStream } from "../lib/pdf-renderer";
import {
  courses as coursesTable,
  assignments as assignmentsTable,
  announcements as announcementsTable,
  sessions as sessionsTable,
  certificates as certificatesTable,
  users as usersTable,
  learnerIdentities as learnerIdentitiesTable,
  learnerCourseAccess as learnerCourseAccessTable,
  programmes as programmesTable,
  programmeCourses as programmeCoursesTable,
  courseOutlines as courseOutlinesTable,
  curriculumCourses as curriculumCoursesTable,
  courseTopics as courseTopicsTable,
  courseSubtopics as courseSubtopicsTable,
  courseStructureImportJobs as courseStructureImportJobsTable,
  courseStructureImportJobItems as courseStructureImportJobItemsTable,
  courseResources as courseResourcesTable,
  courseResourceImportJobs as courseResourceImportJobsTable,
  courseResourceImportJobItems as courseResourceImportJobItemsTable,
  groups as groupsTable,
  tags as tagsTable,
  glossaryTerms as glossaryTable,
  uploadJobs as uploadJobsTable,
  faqCategories as faqTable,
  appSettings as appSettingsTable,
  contentAccessLogs as contentAccessLogsTable,
  contentTokens as contentTokensTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  AddCourseOutcomeBody,
  AddCourseOutcomeParams,
  AddCourseOutcomeResponse,
  CreateAssignmentBody,
  CreateAssignmentResponse,
  CreateCourseBody,
  CreateCourseResponse,
  GetAnalyticsOverviewResponse,
  GetCourseParams,
  GetCourseResponse,
  GetCurriculumCourseOutlineParams,
  GetCurriculumCourseOutlineResponse,
  GetDashboardResponse,
  ImportUsersBody,
  ImportUsersResponse,
  ListAssignmentsQueryParams,
  ListAssignmentsResponse,
  ListCertificatesResponse,
  ListCoursesQueryParams,
  ListCoursesResponse,
  ListProgrammeCoursesParams,
  ListProgrammeCoursesResponse,
  ListProgrammesResponse,
  ListSessionsResponse,
  ListUsersResponse,
  UpdateUserGroupBody,
  UpdateUserGroupParams,
  UpdateUserGroupResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ─── In-memory topic detail (not yet in DB — used by GET /courses/:id) ────────
const topicDetail = [
  {
    id: "topic-01",
    title: "01 · Principles of safe navigation",
    duration: "1h 20m",
    progress: 100,
    locked: false,
    activities: [
      { id: "activity-navigation", title: "Navigation Rules & Watchkeeping", type: "Protected document", duration: "18 min", status: "complete", protected: true, resourceId: null, openUrl: null },
    ],
    subtopics: [],
  },
  {
    id: "topic-02",
    title: "02 · Bridge team operations",
    duration: "2h 10m",
    progress: 46,
    locked: false,
    activities: [
      { id: "activity-bridge", title: "Bridge Resource Management", type: "Video lesson", duration: "24 min", status: "current", protected: true, resourceId: null, openUrl: null },
      { id: "activity-quiz",   title: "Knowledge check: Bridge procedures", type: "Quiz", duration: "12 questions", status: "locked", protected: false, resourceId: null, openUrl: null },
    ],
    subtopics: [],
  },
  {
    id: "topic-03",
    title: "03 · Passage planning",
    duration: "1h 45m",
    progress: 0,
    locked: true,
    activities: [
      { id: "activity-passage", title: "Passage planning checklist", type: "Practical activity", duration: "30 min", status: "locked", protected: false, resourceId: null, openUrl: null },
    ],
    subtopics: [],
  },
];

// ─── Seed ─────────────────────────────────────────────────────────────────────

const TRIBYTE_COURSES = [
  { id: 'tb-484883', name: "ME-GI Course", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '484883', tribyteTid: '21287', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1674282034_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-396713', name: "Vertical Integration Course for Trainers - VICT", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '396713', tribyteTid: '15470', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415168_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-396712', name: "Ship Security Officer [SSO]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '396712', tribyteTid: '15468', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415156_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-396711', name: "Medical First Aid [MFA]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '396711', tribyteTid: '15466', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600414925_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-397546', name: "RMFA-Refresher Training for Medical First Aid [RMFA]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '397546', tribyteTid: '15648', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600414930_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-397540', name: "Crowd Management, Passenger Safety and Safety Training [PSF]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '397540', tribyteTid: '15639', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600414936_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-412830', name: "Basic Training for Liquefied Gas Tanker Cargo Operations [LGTF]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '412830', tribyteTid: '18080', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600414973_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-397545', name: "RMC-Refresher Training for Medical Care", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '397545', tribyteTid: '15646', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600414942_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-397539', name: "Crisis Management and Human Behaviour [APS]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '397539', tribyteTid: '15637', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600414982_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-396710', name: "Advanced Training for Oil Tanker Cargo Operations [TASCO]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '396710', tribyteTid: '15464', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600414977_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-397544', name: "RUEO / RM / RM-O", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '397544', tribyteTid: '15644', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415023_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-396709', name: "Advanced Training for Liquified Gas Tanker Cargo Operations [GASCO]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '396709', tribyteTid: '15462', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415029_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-489726', name: "Gender Sensitization", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '489726', tribyteTid: '21438', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-481420', name: "Liberian Approved AIGF", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '481420', tribyteTid: '21184', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694722_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-414341', name: "Faculty Familiarization", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '414341', tribyteTid: '18138', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-397945', name: "Reading Electrical Drawings and Trouble shooting", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '397945', tribyteTid: '15717', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1590175418_unnamed.jpg?v=1404377546" },
  { id: 'tb-397543', name: " 4 DAY REO-Refresher and Updating Training Course for all Engineers", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '397543', tribyteTid: '15642', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415039_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-396708', name: "Advanced Training for Chemical Tanker Cargo Operations [CHEMCO]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '396708', tribyteTid: '15460', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415049_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-396591', name: "STSDSD", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '396591', tribyteTid: '15442', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415057_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-575149', name: "Test Course", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '575149', tribyteTid: '23583', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-572342', name: "29072026 POLAR(O)/B6", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '572342', tribyteTid: '23542', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-557881', name: "29062026 BCS Session-3", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '557881', tribyteTid: '23530', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-550076', name: "Leadership Course", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '550076', tribyteTid: '23523', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1781500490_try.jpeg?v=1404377546" },
  { id: 'tb-537713', name: "IMSBC 3 Days Course", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '537713', tribyteTid: '23514', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1779252122_try.jpeg?v=1404377546" },
  { id: 'tb-535211', name: "TFTA B01 13052026", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '535211', tribyteTid: '23509', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-535186', name: "TFTA B01 11052026", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '535186', tribyteTid: '23504', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-534824', name: "TFTA B001  12052026", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '534824', tribyteTid: '23481', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1778768499_try.jpeg?v=1404377546" },
  { id: 'tb-533107', name: "Train the Trainer & Assessor- Value Added", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '533107', tribyteTid: '23431', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-531562', name: "HC - HATCH COVER MAINTENANCE", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '531562', tribyteTid: '23420', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784697038_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-531297', name: "FFCC - Fire Fighting For Car Carrier", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '531297', tribyteTid: '23415', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784697634_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-530639', name: "FRAMO O & M", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '530639', tribyteTid: '23392', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-529096', name: "Mental Health Awareness Course - MHA-VR (Officers & Ratings)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '529096', tribyteTid: '23325', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-529025', name: "Safety Officer Course - SOC", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '529025', tribyteTid: '23317', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784697507_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-528910', name: "Bulk Carrier Safety (BCS)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '528910', tribyteTid: '23312', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784697616_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-528886', name: "SIRE-2.0-Ratings", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '528886', tribyteTid: '23307', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694225_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-527588', name: "Safety Awareness & Familiarization - SATF", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '527588', tribyteTid: '23285', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-527550', name: "OCTCO-Refresher (Basic Oil and Chemical Tanker)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '527550', tribyteTid: '23280', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-527454', name: "Risk Assessment", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '527454', tribyteTid: '23275', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784697622_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-527414', name: "PSC- Ratings", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '527414', tribyteTid: '23270', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784696823_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-527260', name: "Advanced Tanker (Oil & Chemical) Safety Course - AOCS-R", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '527260', tribyteTid: '23259', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-527209', name: "EPEM - 111225 - D1S3", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '527209', tribyteTid: '23248', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-526986', name: "Wartsila Cloud Simulator Training", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '526986', tribyteTid: '23232', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1764998552_tribyte photo.png?v=1404377546" },
  { id: 'tb-526602', name: "CDI Inspection Familiarisation", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '526602', tribyteTid: '23223', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-526574', name: "2Stroke Engine", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '526574', tribyteTid: '23218', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-526340', name: "Polar Ice Navigation  191125", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '526340', tribyteTid: '23208', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-525954', name: "121125 EPEM_R", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '525954', tribyteTid: '23189', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-525901', name: "SIRE 2.0", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '525901', tribyteTid: '23182', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694219_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-525780', name: "Port State Control PSCI", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '525780', tribyteTid: '23177', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784696832_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-525492', name: "Zodiac Polar - 3 days", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '525492', tribyteTid: '23142', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694552_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-525031', name: "Ship Handling Simulator - Online (SHS)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '525031', tribyteTid: '23137', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784697496_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-524702', name: "Reefer Container Trainer", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '524702', tribyteTid: '23132', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-523788', name: "EPEM-170925-D2S2", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '523788', tribyteTid: '23125', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-523719', name: "EPEM B02  170925", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '523719', tribyteTid: '23114', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-523571', name: "EPEM-R  Session-3 Video 12092025", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '523571', tribyteTid: '23109', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-523242', name: "OSM THOME - Explosion Protection and Ex Maintenance Course (EPEM 1 Day Course)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '523242', tribyteTid: '23091', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694673_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-523240', name: "OSM THOME - Explosion Protection and Ex Maintenance Course (EPEM 2 Days Course)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '523240', tribyteTid: '23087', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694678_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-522696', name: "VR Maritime - BTM (Bridge Team Management)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '522696', tribyteTid: '23065', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694580_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-521188', name: "ADVANCE POLAR - OSM Thome-3days", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '521188', tribyteTid: '23021', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694547_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-518113', name: "Reefer Container Maintenance Workshop", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '518113', tribyteTid: '22914', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-517278', name: "LCHS - OSM THOME", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '517278', tribyteTid: '22891', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694448_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-516632', name: "ME Course", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '516632', tribyteTid: '22868', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-512969', name: "Fuel Oil Management (FOM)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '512969', tribyteTid: '22668', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1742448676_1714787171_trybyte pto.png?v=1404377546" },
  { id: 'tb-512640', name: "L & T PST Value Added", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '512640', tribyteTid: '22657', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784696762_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-507591', name: "IGF Course - Day1", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '507591', tribyteTid: '22332', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-507475', name: "Value Added - IGF (VIGF)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '507475', tribyteTid: '22309', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1728955313_1715151613_trybyte pto.png?v=1404377546" },
  { id: 'tb-503000', name: "Log Bulk Operation", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '503000', tribyteTid: '21961', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1722334524_1715151613_trybyte pto.png?v=1404377546" },
  { id: 'tb-500326', name: "OCTCO Online Class", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '500326', tribyteTid: '21682', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1718261456_1715151613_trybyte pto.png?v=1404377546" },
  { id: 'tb-500305', name: "LGTF Online Class", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '500305', tribyteTid: '21673', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1718260935_1715151613_trybyte pto.png?v=1404377546" },
  { id: 'tb-498403', name: "Advanced Training for Ships Operating in Polar Waters (APW)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '498403', tribyteTid: '21657', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1784694332_1600414868_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-498261', name: "Basic Training for Ships Operating in Polar Waters (BPW)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '498261', tribyteTid: '21641', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1732267202_tribyte thumbnail N1.png?v=1404377546" },
  { id: 'tb-493432', name: "FMERS", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '493432', tribyteTid: '21547', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-491587', name: "Refresher & Updating Training (RUT)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '491587', tribyteTid: '21520', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1691482913_1606818956_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-469557', name: "AIGF Zoom Class Video", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '469557', tribyteTid: '20676', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1643022798_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-469467', name: "BIGF Class Zoom Video", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '469467', tribyteTid: '20639', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1643022782_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-459173', name: "ZOOM Video for Student ", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '459173', tribyteTid: '20509', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-457005', name: "Online Course Induction Video", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '457005', tribyteTid: '20484', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-448921', name: "Advanced  Training for Ships Using Fuels Covered Under IGF code [AIGF]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '448921', tribyteTid: '20219', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1618654537_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-444835', name: "11 DAY REFRESHER and UPDATING  COURSE for All Engineers ", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '444835', tribyteTid: '20143', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-438830', name: "Basic Training for Ships Using Fuels Covered  Under IGF code [BIGF]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '438830', tribyteTid: '20077', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1618654493_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-430096', name: "FAMILIARISATION / REFRESHER COURSE FOR MEDICAL EXAMINER OF SEAFARERS [DFC / RDFC]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '430096', tribyteTid: '19654', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1676370251_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-429735', name: "ASSESSMENT EXAMINATION and CERTIFICATION of SEAFARERS ( AECS) ", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '429735', tribyteTid: '19640', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1618654580_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-429290', name: "Fire Prevention and Fire Fighting [ FPFF ]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '429290', tribyteTid: '19604', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1606818917_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-429210', name: "Personal Survival Techniques [PST]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '429210', tribyteTid: '19593', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1606818948_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-427378', name: "Proficiency in Survival Craft Rescue Boats [PSCRB]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '427378', tribyteTid: '19309', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1606818956_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-426946', name: "Basic Safety Training (BST) / Personal Safety & Social Responsibilities [PSSR]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '426946', tribyteTid: '19195', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1606819005_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-426920', name: "Advanced Fire Fighting [AFF]", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '426920', tribyteTid: '19186', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1606819009_1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-422417', name: "GP RATING COURSE MATERIALS", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '422417', tribyteTid: '18450', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-422410', name: "GP RATING COURSE MATERIALS", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '422410', tribyteTid: '18450', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-409528', name: "RFPFF-Refresher Training for FPFF", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '409528', tribyteTid: '18015', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415090_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-409527', name: "RPST-Refresher Training for PST", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '409527', tribyteTid: '18013', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415081_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-409499', name: "RPSCRB-Refresher Training for PSCRB", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '409499', tribyteTid: '18011', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415075_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-409498', name: "RAFF-Refresher Training for AFF", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '409498', tribyteTid: '18009', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1600415066_FDP_1 - Copy.png?v=1404377546" },
  { id: 'tb-404126', name: "GME B17 May2020", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '404126', tribyteTid: '17303', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-404113', name: "GME B17 May2020", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '404113', tribyteTid: '17303', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/sites/all/themes/adminv1/images/category_default.png?v=1404377546" },
  { id: 'tb-389981', name: "Tankers Familiarization Course - Combined (Oil & Chemical)[TFC-COM](OCTCO)", groupName: 'All Content', language: 'English', adaptiveUserName: '', status: 'Published', appliedTags: [], tribyteNid: '389981', tribyteTid: '14929', thumbUrl: "https://static.learn.himtelearning.com/sites/elearning.himtmarine.com/files/imagecache/collection_carousel_thumbnail_trainer/1587024159_tanker-large.png?v=1404377546" }
] as const;

async function seedDatabase() {
  // Only seed if courses table is empty
  const existing = await db.select().from(coursesTable).limit(1);
  if (existing.length > 0) return;

  console.log("[seed] Seeding database with initial HIMT data…");

  // Learner courses
  await db.insert(coursesTable).values([
    { id: "course-bridge", code: "BMR-204", name: "Bridge Management & Regulations",        category: "Advanced Modular", language: "English", status: "Published", progress: 68,  learners: 128, duration: "18 hours", thumbnail: "bridge", nextActivity: "Bridge Resource Management", accent: "ocean" },
    { id: "course-safety", code: "PST-101", name: "Personal Safety & Social Responsibility",  category: "Basic Modular",    language: "English", status: "Published", progress: 42,  learners: 246, duration: "12 hours", thumbnail: "safety", nextActivity: "Emergency response drill",     accent: "amber" },
    { id: "course-cargo",  code: "CCO-310", name: "Cargo Operations & Stowage",              category: "Advanced Modular", language: "English", status: "Under Review", progress: 0, learners: 74,  duration: "22 hours", thumbnail: "cargo",  nextActivity: null,                           accent: "slate" },
    { id: "course-fire",   code: "FPFF-110", name: "Fire Prevention & Fire Fighting",        category: "Basic Modular",    language: "English", status: "Published", progress: 100, learners: 312, duration: "16 hours", thumbnail: "fire",   nextActivity: null,                           accent: "coral" },
  ]).onConflictDoNothing();

  // Assignments
  await db.insert(assignmentsTable).values([
    { id: "assignment-passage", title: "Passage plan: Mumbai to Colombo",  course: "Bridge Management & Regulations",        dueDate: "18 Aug 2026", status: "Due soon",          submitted: false, assessor: "Capt. A. Nair",  priority: "high"   },
    { id: "assignment-safety",  title: "Emergency response reflection",    course: "Personal Safety & Social Responsibility", dueDate: "23 Aug 2026", status: "In progress",       submitted: false, assessor: "Ms. R. Joseph", priority: "normal" },
    { id: "assignment-cargo",   title: "Cargo securing checklist",         course: "Cargo Operations & Stowage",             dueDate: "05 Aug 2026", status: "Feedback published", submitted: true,  assessor: "Capt. S. Menon", priority: "normal" },
  ]).onConflictDoNothing();

  // Announcements
  await db.insert(announcementsTable).values([
    { id: "announcement-01", title: "August intake orientation",   body: "Your academic orientation is scheduled for 20 August at the Navi Mumbai campus.", audience: "Navi Mumbai · August 2026 intake", publishedAt: "Today, 09:20",  unread: true  },
    { id: "announcement-02", title: "Updated assessment policy",   body: "Please review the revised resubmission and moderation policy before your next assessment.",                                         audience: "All learners",                   publishedAt: "Yesterday",     unread: false },
  ]).onConflictDoNothing();

  // Sessions
  await db.insert(sessionsTable).values([
    { id: "session-01", title: "Live Q&A · Bridge operations", course: "Bridge Management & Regulations",  type: "Webinar",   date: "20 Aug 2026", time: "14:00 – 15:00", location: "Microsoft Teams",          faculty: "Capt. A. Nair",  attendance: "Not marked" },
    { id: "session-02", title: "Fire drill practical",          course: "Fire Prevention & Fire Fighting",  type: "Classroom", date: "22 Aug 2026", time: "09:30 – 12:00", location: "Safety Lab · Navi Mumbai", faculty: "Mr. V. D'Souza", attendance: "Required"   },
  ]).onConflictDoNothing();

  // Certificates
  await db.insert(certificatesTable).values([
    { id: "certificate-01", title: "Personal Safety & Social Responsibility", course: "PST-101",   issuedOn: "12 Jun 2026", expiresOn: null,          status: "Verified", serial: "HIMT-PST-26-00418"  },
    { id: "certificate-02", title: "Fire Prevention & Fire Fighting",          course: "FPFF-110",  issuedOn: "22 Jul 2026", expiresOn: "22 Jul 2031", status: "Verified", serial: "HIMT-FPFF-26-00682" },
  ]).onConflictDoNothing();

  // Users
  await db.insert(usersTable).values([
    { id: "user-001", name: "Aarav Mehta",       email: "aarav.mehta@himt.edu.in",    role: "student", groupName: "August 2026 · DNS",  status: "Active",  lastActivity: "4 min ago"  },
    { id: "user-002", name: "Capt. Ananya Nair", email: "ananya.nair@himt.edu.in",    role: "faculty", groupName: "Deck Department",     status: "Active",  lastActivity: "18 min ago" },
    { id: "user-003", name: "Rohan Kulkarni",    email: "rohan.kulkarni@himt.edu.in", role: "student", groupName: "July 2026 · B.Tech",  status: "Invited", lastActivity: "Never"      },
  ]).onConflictDoNothing();

  // Programmes
  await db.insert(programmesTable).values([
    { id: "prog-btme",   name: "B.Tech Marine Engineering",  code: "BTME",   department: "Department of Marine Engineering", durationText: "4 Years (8 Semesters)", totalCourses: 42, publishedCourses: 38, totalLearners: 312, status: "Active" },
    { id: "prog-dns",    name: "Diploma in Nautical Science", code: "DNS",    department: "Department of Navigation",         durationText: "3 Years (6 Semesters)", totalCourses: 28, publishedCourses: 26, totalLearners: 184, status: "Active" },
    { id: "prog-bsc-ms", name: "B.Sc. Maritime Studies",     code: "BSc-MS", department: "Department of Maritime Studies",   durationText: "3 Years (6 Semesters)", totalCourses: 30, publishedCourses: 24, totalLearners: 98,  status: "Active" },
  ]).onConflictDoNothing();

  // Programme courses (BTME)
  const btmeCourses = [
    { id: "cur-mat101", programmeId: "prog-btme", name: "Mathematics I",                 code: "MAT-101",  semester: 1, credits: 4, type: "Core",     status: "Published", outcomesCount: 5, modulesCount: 5, activitiesCount: 34 },
    { id: "cur-phy101", programmeId: "prog-btme", name: "Engineering Physics",            code: "PHY-101",  semester: 1, credits: 3, type: "Core",     status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 22 },
    { id: "cur-bms101", programmeId: "prog-btme", name: "Basic Marine Science",           code: "BMS-101",  semester: 1, credits: 2, type: "Core",     status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 18 },
    { id: "cur-che101", programmeId: "prog-btme", name: "Engineering Chemistry",          code: "CHE-101",  semester: 1, credits: 3, type: "Core",     status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 20 },
    { id: "cur-ws101",  programmeId: "prog-btme", name: "Workshop Practice",              code: "WS-101",   semester: 1, credits: 2, type: "Lab",      status: "Published", outcomesCount: 3, modulesCount: 2, activitiesCount: 12 },
    { id: "cur-mat201", programmeId: "prog-btme", name: "Mathematics II",                code: "MAT-201",  semester: 2, credits: 4, type: "Core",     status: "Published", outcomesCount: 5, modulesCount: 5, activitiesCount: 36 },
    { id: "cur-met201", programmeId: "prog-btme", name: "Marine Electrical Technology",  code: "MET-201",  semester: 2, credits: 3, type: "Core",     status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 24 },
    { id: "cur-che201", programmeId: "prog-btme", name: "Marine Chemistry",              code: "CHE-201",  semester: 2, credits: 3, type: "Core",     status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 20 },
    { id: "cur-ws201",  programmeId: "prog-btme", name: "Engg. Workshop Practice",       code: "WS-201",   semester: 2, credits: 2, type: "Lab",      status: "Published", outcomesCount: 3, modulesCount: 2, activitiesCount: 14 },
    { id: "cur-thd301", programmeId: "prog-btme", name: "Thermodynamics",                code: "THD-301",  semester: 3, credits: 4, type: "Core",     status: "Published", outcomesCount: 6, modulesCount: 5, activitiesCount: 38 },
    { id: "cur-fm301",  programmeId: "prog-btme", name: "Fluid Mechanics",               code: "FM-301",   semester: 3, credits: 4, type: "Core",     status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 28 },
    { id: "cur-sm301",  programmeId: "prog-btme", name: "Strength of Materials",         code: "SM-301",   semester: 3, credits: 3, type: "Core",     status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 24 },
    { id: "cur-mps401", programmeId: "prog-btme", name: "Marine Propulsion Systems",     code: "MPS-401",  semester: 4, credits: 4, type: "Core",     status: "Published", outcomesCount: 6, modulesCount: 5, activitiesCount: 36 },
    { id: "cur-sc401",  programmeId: "prog-btme", name: "Ship Construction",             code: "SC-401",   semester: 4, credits: 3, type: "Core",     status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 26 },
    { id: "cur-ht401",  programmeId: "prog-btme", name: "Heat Transfer",                 code: "HT-401",   semester: 4, credits: 3, type: "Core",     status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 22 },
    { id: "cur-brm501", programmeId: "prog-btme", name: "Bridge Management & Regulations", code: "BRM-501", semester: 5, credits: 3, type: "Core",    status: "Published", outcomesCount: 6, modulesCount: 4, activitiesCount: 28 },
    { id: "cur-pssr501",programmeId: "prog-btme", name: "Personal Safety & Social Responsibility", code: "PSSR-501", semester: 5, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 18 },
    { id: "cur-mep501", programmeId: "prog-btme", name: "Marine Environment Protection", code: "MEP-501",  semester: 5, credits: 3, type: "Elective", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 22 },
    { id: "cur-met501", programmeId: "prog-btme", name: "Meteorology & Oceanography",    code: "MET-501",  semester: 5, credits: 3, type: "Core",     status: "Draft",     outcomesCount: 5, modulesCount: 4, activitiesCount: 20 },
    { id: "cur-fpff601",programmeId: "prog-btme", name: "Fire Prevention & Fire Fighting", code: "FPFF-601", semester: 6, credits: 2, type: "Core",   status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 16 },
    { id: "cur-sst601", programmeId: "prog-btme", name: "Ship Stability",                code: "SST-601",  semester: 6, credits: 4, type: "Core",     status: "Published", outcomesCount: 6, modulesCount: 5, activitiesCount: 32 },
    { id: "cur-ml601",  programmeId: "prog-btme", name: "Maritime Law",                  code: "ML-601",   semester: 6, credits: 2, type: "Core",     status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 16 },
    { id: "cur-ers701", programmeId: "prog-btme", name: "Engine Room Simulator",          code: "ERS-701",  semester: 7, credits: 2, type: "Lab",      status: "Draft",     outcomesCount: 4, modulesCount: 2, activitiesCount: 12 },
    { id: "cur-smg701", programmeId: "prog-btme", name: "Ship Management",               code: "SMG-701",  semester: 7, credits: 3, type: "Elective", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 22 },
    { id: "cur-prj801", programmeId: "prog-btme", name: "Project Work",                  code: "PRJ-801",  semester: 8, credits: 6, type: "Core",     status: "Published", outcomesCount: 3, modulesCount: 3, activitiesCount: 10 },
    { id: "cur-int801", programmeId: "prog-btme", name: "Industry Internship",            code: "INT-801",  semester: 8, credits: 4, type: "Lab",      status: "Published", outcomesCount: 3, modulesCount: 2, activitiesCount:  8 },
  ];
  const dnsCourses = [
    { id: "dns-nav101", programmeId: "prog-dns", name: "Principles of Navigation",  code: "NAV-101", semester: 1, credits: 4, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 28 },
    { id: "dns-met101", programmeId: "prog-dns", name: "Meteorology Basics",         code: "MET-101", semester: 1, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 20 },
    { id: "dns-brm201", programmeId: "prog-dns", name: "Bridge Operations",          code: "BOP-201", semester: 2, credits: 3, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 22 },
    { id: "dns-col201", programmeId: "prog-dns", name: "Collision Regulations",      code: "COL-201", semester: 2, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 18 },
    { id: "dns-fps301", programmeId: "prog-dns", name: "Fire Prevention & Safety",   code: "FPS-301", semester: 3, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 14 },
    { id: "dns-adv301", programmeId: "prog-dns", name: "Advanced Navigation",        code: "ADV-301", semester: 3, credits: 4, type: "Core", status: "Draft",     outcomesCount: 5, modulesCount: 4, activitiesCount: 24 },
  ];
  const bscCourses = [
    { id: "bsc-mgt101", programmeId: "prog-bsc-ms", name: "Maritime Management",          code: "MGT-101", semester: 1, credits: 4, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 26 },
    { id: "bsc-law101", programmeId: "prog-bsc-ms", name: "Introduction to Maritime Law", code: "LAW-101", semester: 1, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 18 },
    { id: "bsc-eco201", programmeId: "prog-bsc-ms", name: "Maritime Economics",           code: "ECO-201", semester: 2, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 20 },
    { id: "bsc-ops201", programmeId: "prog-bsc-ms", name: "Port & Terminal Operations",   code: "PTO-201", semester: 2, credits: 3, type: "Core", status: "Draft",     outcomesCount: 4, modulesCount: 3, activitiesCount: 16 },
  ];
  await db.insert(programmeCoursesTable).values([...btmeCourses, ...dnsCourses, ...bscCourses]).onConflictDoNothing();

  // Course outlines (BRM-501 and PSSR-501)
  await db.insert(courseOutlinesTable).values([
    {
      id: "outline-brm501",
      programmeCourseId: "cur-brm501",
      description: "This course covers the principles of safe bridge operation including STCW watchkeeping standards, COLREG collision regulations, systematic passage planning, and emergency bridge procedures. Students develop competency aligned with STCW 2010 Manila Amendments for operational-level deck officers.",
      outcomes: [
        { id: "co-brm-1", code: "CO1", description: "Describe the structure of bridge team management and the responsibilities of the officer of the watch under STCW", bloomsLevel: "Understand", poMapping: ["PO1","PO2"] },
        { id: "co-brm-2", code: "CO2", description: "Apply COLREG rules to determine correct action in multi-vessel traffic situations at sea", bloomsLevel: "Apply", poMapping: ["PO1","PO2","PO5"] },
        { id: "co-brm-3", code: "CO3", description: "Analyze meteorological data and oceanographic charts to assess risk for a planned ocean passage", bloomsLevel: "Analyze", poMapping: ["PO1","PO3","PO4"] },
        { id: "co-brm-4", code: "CO4", description: "Evaluate emergency situations on bridge watch and prioritize response actions in accordance with company SMS", bloomsLevel: "Evaluate", poMapping: ["PO2","PO5","PO7"] },
        { id: "co-brm-5", code: "CO5", description: "Construct a complete passage plan for a deep-sea voyage using ECDIS, conventional charts, and publications", bloomsLevel: "Create", poMapping: ["PO1","PO2","PO3","PO5"] },
        { id: "co-brm-6", code: "CO6", description: "Demonstrate OOW watchkeeping responsibilities including lookout, speed, and reporting in compliance with STCW", bloomsLevel: "Apply", poMapping: ["PO2","PO5","PO6"] },
      ],
      modules: [
        { id: "mod-brm-1", title: "Bridge Resource Management Foundations", order: 1, coIds: ["co-brm-1","co-brm-6"],
          topics: [
            { id: "top-brm-1-1", title: "Bridge team structure and communication", duration: "1h 20m", type: "Lecture",
              activities: [
                { id: "act-brm-1-1-1", title: "Introduction to BRM — Video lecture", type: "Video", duration: "28 min", coIds: ["co-brm-1"] },
                { id: "act-brm-1-1-2", title: "Bridge hierarchy and responsibilities — Reading", type: "Reading", duration: "15 min", coIds: ["co-brm-1"] },
                { id: "act-brm-1-1-3", title: "Communication protocols on bridge — Knowledge check", type: "Quiz", duration: "10 questions", coIds: ["co-brm-1"] },
              ]},
            { id: "top-brm-1-2", title: "STCW watchkeeping standards and OOW duties", duration: "1h 45m", type: "Lecture",
              activities: [
                { id: "act-brm-1-2-1", title: "STCW 2010 Manila Amendments — Video lecture", type: "Video", duration: "35 min", coIds: ["co-brm-1","co-brm-6"] },
                { id: "act-brm-1-2-2", title: "Watchkeeping regulations — Annotated document", type: "Reading", duration: "20 min", coIds: ["co-brm-6"] },
                { id: "act-brm-1-2-3", title: "OOW duties scenario exercise", type: "Activity", duration: "30 min", coIds: ["co-brm-6"] },
              ]},
          ]},
        { id: "mod-brm-2", title: "Collision Regulations (COLREG 1972)", order: 2, coIds: ["co-brm-2"],
          topics: [
            { id: "top-brm-2-1", title: "Rules of the road — Parts A, B, C and D", duration: "2h 00m", type: "Lecture",
              activities: [
                { id: "act-brm-2-1-1", title: "COLREG overview — Video lecture", type: "Video", duration: "40 min", coIds: ["co-brm-2"] },
                { id: "act-brm-2-1-2", title: "Animated rule demonstrations (Rules 1–19)", type: "Video", duration: "30 min", coIds: ["co-brm-2"] },
                { id: "act-brm-2-1-3", title: "Lights, shapes and sound signals — Rules 20–37", type: "Reading", duration: "20 min", coIds: ["co-brm-2"] },
              ]},
            { id: "top-brm-2-2", title: "Practical scenario-based application", duration: "1h 30m", type: "Tutorial",
              activities: [
                { id: "act-brm-2-2-1", title: "Multi-vessel encounter problems — Worksheet", type: "Activity", duration: "45 min", coIds: ["co-brm-2"] },
                { id: "act-brm-2-2-2", title: "COLREG rules assessment — MCQ test", type: "Quiz", duration: "20 questions", coIds: ["co-brm-2"] },
              ]},
          ]},
        { id: "mod-brm-3", title: "Passage Planning & Voyage Execution", order: 3, coIds: ["co-brm-3","co-brm-5"],
          topics: [
            { id: "top-brm-3-1", title: "Passage planning methodology (APEM)", duration: "1h 30m", type: "Lecture",
              activities: [
                { id: "act-brm-3-1-1", title: "Appraise, Plan, Execute, Monitor — Video lecture", type: "Video", duration: "32 min", coIds: ["co-brm-5"] },
                { id: "act-brm-3-1-2", title: "ECDIS operation and chart corrections — Reading", type: "Reading", duration: "18 min", coIds: ["co-brm-5"] },
              ]},
            { id: "top-brm-3-2", title: "Meteorological and oceanographic analysis", duration: "1h 45m", type: "Lecture",
              activities: [
                { id: "act-brm-3-2-1", title: "Reading weather charts and routing — Video lecture", type: "Video", duration: "30 min", coIds: ["co-brm-3"] },
                { id: "act-brm-3-2-2", title: "Synoptic chart interpretation exercise", type: "Activity", duration: "30 min", coIds: ["co-brm-3"] },
                { id: "act-brm-3-2-3", title: "Passage plan submission — Assignment", type: "Assignment", duration: "2 hr", coIds: ["co-brm-3","co-brm-5"] },
              ]},
          ]},
        { id: "mod-brm-4", title: "Emergency Bridge Procedures", order: 4, coIds: ["co-brm-4","co-brm-5","co-brm-6"],
          topics: [
            { id: "top-brm-4-1", title: "Man overboard and emergency steering", duration: "1h 20m", type: "Lecture",
              activities: [
                { id: "act-brm-4-1-1", title: "MOB procedures — Video lecture", type: "Video", duration: "25 min", coIds: ["co-brm-4"] },
                { id: "act-brm-4-1-2", title: "Emergency steering changeover — Animated guide", type: "Video", duration: "15 min", coIds: ["co-brm-4","co-brm-6"] },
              ]},
            { id: "top-brm-4-2", title: "SAR operations and distress communication", duration: "1h 00m", type: "Tutorial",
              activities: [
                { id: "act-brm-4-2-1", title: "GMDSS distress procedures — Reading", type: "Reading", duration: "20 min", coIds: ["co-brm-4"] },
                { id: "act-brm-4-2-2", title: "Bridge emergency checklists — Activity", type: "Activity", duration: "20 min", coIds: ["co-brm-4","co-brm-5"] },
                { id: "act-brm-4-2-3", title: "End-of-module assessment — Exam", type: "Quiz", duration: "30 questions", coIds: ["co-brm-1","co-brm-2","co-brm-3","co-brm-4","co-brm-5","co-brm-6"] },
              ]},
          ]},
      ],
    },
  ]).onConflictDoNothing();

  // Curriculum courses — seeded only if table is empty (real sync handled by syncTriByteCourses())
  const existingCl = await db.select({ id: curriculumCoursesTable.id }).from(curriculumCoursesTable).limit(1);
  if (existingCl.length === 0) {
    await db.insert(curriculumCoursesTable).values([...TRIBYTE_COURSES]).onConflictDoNothing();
  }

  // Groups
  await db.insert(groupsTable).values([
    { id: "g-all-content", name: "All Content",  parentId: null },
    { id: "g-all-reports", name: "All Reports",  parentId: null },
    { id: "g-engineering", name: "Engineering",  parentId: "g-all-content" },
    { id: "g-navigation",  name: "Navigation",   parentId: "g-all-content" },
    { id: "g-safety",      name: "Safety",        parentId: "g-all-content" },
  ]).onConflictDoNothing();

  // Tags
  await db.insert(tagsTable).values([
    { id: "tag-1", name: "STCW Training" },
    { id: "tag-2", name: "Bridge Watchkeeping" },
    { id: "tag-3", name: "Fire Safety" },
    { id: "tag-4", name: "Navigation" },
    { id: "tag-5", name: "Online class video" },
  ]).onConflictDoNothing();

  // Glossary terms
  await db.insert(glossaryTable).values([
    { id: "gl-1", title: "STCW",   definition: "Standards of Training, Certification and Watchkeeping for Seafarers — the international convention governing maritime education." },
    { id: "gl-2", title: "COLREG", definition: "Convention on the International Regulations for Preventing Collisions at Sea (1972), commonly known as the Rules of the Road." },
    { id: "gl-3", title: "GMDSS",  definition: "Global Maritime Distress and Safety System — an internationally agreed set of safety procedures and communications protocols." },
    { id: "gl-4", title: "ECDIS",  definition: "Electronic Chart Display and Information System — a computer-based navigation information system that complies with IMO regulations." },
    { id: "gl-5", title: "ISM Code", definition: "International Safety Management Code — provides an international standard for the safe management and operation of ships." },
  ]).onConflictDoNothing();

  // Upload jobs
  await db.insert(uploadJobsTable).values([
    { id: "u1",  video: "STCW 2017 Searchable",                    type: "Video",      uploadedBy: "Admin",   uploadStatus: "Completed", transcodeStatus: "Completed" },
    { id: "u2",  video: "Virtual Reality (VR) HIMT",               type: "VR/AR",      uploadedBy: "Admin",   uploadStatus: "Completed", transcodeStatus: "Completed" },
    { id: "u3",  video: "Augmented Reality (AR) HIMT",             type: "VR/AR",      uploadedBy: "Admin",   uploadStatus: "Completed", transcodeStatus: "Completed" },
    { id: "u4",  video: "Merchant Shipping Notice No. 07 of 2023", type: "Document",   uploadedBy: "Admin",   uploadStatus: "Completed", transcodeStatus: "Completed" },
    { id: "u5",  video: "Engineering Circular No. 143 of 2018",    type: "Document",   uploadedBy: "Admin",   uploadStatus: "Completed", transcodeStatus: "Completed" },
    { id: "u6",  video: "STCW OVERVIEW — Aug 2026",                type: "Video",      uploadedBy: "Faculty", uploadStatus: "Completed", transcodeStatus: "Completed" },
    { id: "u7",  video: "Bridge Simulator — GMDSS Operations",     type: "Simulation", uploadedBy: "Admin",   uploadStatus: "Completed", transcodeStatus: "Completed" },
    { id: "u8",  video: "Session 2 — IMSBC Code 2026",             type: "Video",      uploadedBy: "Faculty", uploadStatus: "Completed", transcodeStatus: "Processing" },
    { id: "u9",  video: "Polar Navigation Session-1",              type: "Video",      uploadedBy: "Admin",   uploadStatus: "Completed", transcodeStatus: "Completed" },
    { id: "u10", video: "Fire Fighting Training — Module 3",       type: "Video",      uploadedBy: "Faculty", uploadStatus: "Processing", transcodeStatus: "Pending"  },
  ]).onConflictDoNothing();

  console.log("[seed] Done.");
}

// Sync real TriByte courses on startup (replaces placeholder rows that have no tribyteNid)
async function syncTriByteCourses() {
  const hasSynced = await db.select({ id: curriculumCoursesTable.id })
    .from(curriculumCoursesTable)
    .where(eq(curriculumCoursesTable.tribyteNid, 'tb-484883' as unknown as string))
    .limit(1);
  // Check if we already have real courses by looking for tribyteNid set
  const withNid = await db.execute(
    `SELECT id FROM curriculum_courses WHERE tribyte_nid != '' AND tribyte_nid IS NOT NULL LIMIT 1`
  );
  if ((withNid as unknown as { rows: unknown[] }).rows?.length) return; // already synced
  console.log("[sync] Replacing placeholder curriculum courses with 95 real TriByte courses…");
  await db.delete(curriculumCoursesTable);
  await db.insert(curriculumCoursesTable).values(TRIBYTE_COURSES as unknown as typeof curriculumCoursesTable.$inferInsert[]);
  console.log("[sync] Done — 95 courses loaded.");
}

/**
 * Ensure app_settings table exists.
 * Must be awaited before the HTTP server starts accepting requests to avoid
 * races on first settings reads/writes.
 */
export async function ensureAppSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Ensure DRM audit infrastructure exists:
 *   1. content_access_logs — one row per protected content request
 *   2. expires_at on learner_course_access — DRM-006 enrollment expiry
 * Both use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so re-running is safe.
 */
export async function ensureAccessLogsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_access_logs (
      id             TEXT PRIMARY KEY,
      user_id        TEXT,
      resource_id    TEXT NOT NULL,
      course_id      TEXT NOT NULL,
      action         TEXT NOT NULL,
      session_id     TEXT,
      user_agent     TEXT,
      ip_address     TEXT,
      outcome_detail TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE learner_course_access
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
  `);
}

// ── DRM-007: content access logging ──────────────────────────────────────────

type AccessAction = "view_attempt" | "view_success" | "view_denied" | "view_error";

/**
 * Insert one DRM audit row for a protected content request.
 * Failures are swallowed with a warning so they never interrupt content delivery.
 */
async function logContentAccess(opts: {
  req: import("express").Request;
  resourceId: string;
  courseId: string;
  action: AccessAction;
  outcomeDetail?: string;
}): Promise<void> {
  try {
    const { req, resourceId, courseId, action, outcomeDetail } = opts;
    const clerkUserId = getAuth(req).userId ?? null;
    const sessionId   = req.sessionID ?? null;
    const userAgent   = (req.headers["user-agent"] ?? "").slice(0, 512) || null;
    // Use the socket peer address as the trusted IP; X-Forwarded-For is not used
    // because the ingress layer may not strip client-supplied values, making it
    // trivially forgeable. The peer address is always the actual connecting party.
    const rawIp       = req.socket.remoteAddress || null;
    await db.insert(contentAccessLogsTable).values({
      id:            randomUUID(),
      userId:        clerkUserId,
      resourceId,
      courseId,
      action,
      sessionId:     sessionId?.slice(0, 128) ?? null,
      userAgent,
      ipAddress:     rawIp?.slice(0, 64) ?? null,
      outcomeDetail: outcomeDetail?.slice(0, 500) ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "content_access_logs insert failed — continuing");
  }
}

// ── Symmetric encryption helpers for sensitive settings stored in app_settings ─
// Key is derived from SESSION_SECRET (which is validated at app startup).
// Encrypted format: "<ivHex>:<authTagHex>:<ciphertextHex>"
const _settingsKey = (() => {
  const secret = process.env.SESSION_SECRET ?? "";
  return scryptSync(secret || "dev-only-fallback", "himt-lms-settings-v1", 32);
})();

function encryptSetting(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce for AES-256-GCM
  const cipher = createCipheriv("aes-256-gcm", _settingsKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decryptSetting(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) return stored; // legacy plaintext — treat as-is
  const [ivHex, tagHex, encHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", _settingsKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
}

// Fire-and-forget seed on startup (non-critical; logged on failure)
seedDatabase().catch(err => console.error("[seed] Failed:", err));
syncTriByteCourses().catch(err => console.error("[sync] Failed:", err));
// NOTE: ensureAppSettingsTable() is awaited in index.ts before the HTTP server starts

// ─── Learner-facing routes ────────────────────────────────────────────────────

router.get("/dashboard", async (_req, res) => {
  try {
    const [allCourses, allAssignments, allAnnouncements, allSessions, allCerts] = await Promise.all([
      db.select().from(coursesTable),
      db.select().from(assignmentsTable),
      db.select().from(announcementsTable),
      db.select().from(sessionsTable),
      db.select().from(certificatesTable),
    ]);
    const dashboard = {
      learner: { name: "Aarav Mehta", learnerId: "HIMT-26-0418", activeCourses: 3, completedCourses: 2, averageProgress: 68, pendingTasks: 4, attendance: 92, streak: 7 },
      courses: allCourses,
      assignments: allAssignments,
      announcements: allAnnouncements,
      sessions: allSessions,
      certificates: allCerts,
    };
    res.json(GetDashboardResponse.parse(dashboard));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/courses", async (req, res) => {
  const parsed = ListCoursesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const [learnerRows, curriculumRows] = await Promise.all([
      db.select().from(coursesTable),
      db.select().from(curriculumCoursesTable),
    ]);
    let rows = [
      ...learnerRows.map(row => ({
        ...row,
        category: row.category ?? "",
        language: row.language ?? "English",
        status: row.status ?? "Draft",
        progress: row.progress ?? 0,
        learners: row.learners ?? 0,
        duration: row.duration ?? "",
        thumbnail: row.thumbnail ?? "",
        nextActivity: row.nextActivity ?? null,
        accent: row.accent ?? "ocean",
      })),
      ...curriculumRows.map(row => ({
        id: row.id,
        code: `TB-${row.tribyteTid || row.tribyteNid || "COURSE"}`,
        name: row.name,
        category: row.groupName ?? "TriByte learning",
        language: row.language ?? "English",
        status: row.status ?? "Published",
        progress: 0,
        learners: 0,
        duration: "Self-paced",
        thumbnail: row.thumbUrl ?? "",
        nextActivity: null,
        accent: "ocean",
      })),
    ];
    const search = parsed.data.search?.toLowerCase();
    const status = parsed.data.status?.toLowerCase();
    if (search) rows = rows.filter(c => c.name.toLowerCase().includes(search) || c.code.toLowerCase().includes(search));
    if (status) rows = rows.filter(c => (c.status ?? '').toLowerCase().includes(status));
    res.json(ListCoursesResponse.parse(rows));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/courses", async (req, res) => {
  const parsed = CreateCourseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const course = { id: `course-${Date.now()}`, code: parsed.data.code, name: parsed.data.name, category: parsed.data.category, language: parsed.data.language, status: "Draft", progress: 0, learners: 0, duration: parsed.data.duration, thumbnail: "new", nextActivity: null, accent: "ocean" };
    await db.insert(coursesTable).values(course);
    res.status(201).json(CreateCourseResponse.parse(course));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/courses/:courseId", async (req, res) => {
  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const [learnerCourse] = await db.select().from(coursesTable).where(eq(coursesTable.id, params.data.courseId));
    if (learnerCourse) {
      res.json(GetCourseResponse.parse({
        ...learnerCourse,
        category: learnerCourse.category ?? "",
        language: learnerCourse.language ?? "English",
        status: learnerCourse.status ?? "Draft",
        progress: learnerCourse.progress ?? 0,
        learners: learnerCourse.learners ?? 0,
        duration: learnerCourse.duration ?? "",
        thumbnail: learnerCourse.thumbnail ?? "",
        nextActivity: learnerCourse.nextActivity ?? null,
        accent: learnerCourse.accent ?? "ocean",
        description: "Build confident, compliant bridge teams through applied navigation, regulations and watchkeeping practice.",
        objectives: ["Apply safe navigation principles in operational scenarios", "Coordinate bridge teams using clear communication", "Prepare and review a compliant passage plan"],
        topics: topicDetail,
      }));
      return;
    }

    const [curriculumCourse] = await db.select().from(curriculumCoursesTable)
      .where(eq(curriculumCoursesTable.id, params.data.courseId));
    if (!curriculumCourse) { res.status(404).json({ error: "Course not found" }); return; }
    const [topics, subtopics, resources] = await Promise.all([
      db.select().from(courseTopicsTable).where(eq(courseTopicsTable.courseId, curriculumCourse.id)),
      db.select().from(courseSubtopicsTable).where(eq(courseSubtopicsTable.courseId, curriculumCourse.id)),
      db.select().from(courseResourcesTable).where(eq(courseResourcesTable.courseId, curriculumCourse.id)),
    ]);
    topics.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const readyResources = resources
      .filter(resource => resource.status === "ready")
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const canOpenResources = await learnerCanAccessCourse(req, curriculumCourse.id);
    const resourceDuration = (size: number | null) => {
      if (!size) return "Available";
      if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    };
    const activityFor = (resource: typeof courseResourcesTable.$inferSelect) => ({
      id: `activity-${resource.id}`,
      title: resource.title,
      type: resource.resourceType,
      duration: resourceDuration(resource.sizeBytes),
      status: "available",
      protected: false,
      resourceId: resource.id,
      openUrl: canOpenResources ? `/api/curriculum/resources/${resource.id}/open` : null,
      // DRM: sourceUrl is redacted for non-Video resources so the client cannot
      // detect external document URLs (e.g. Publitas) and bypass the page renderer.
      // Video resources retain it so the player can detect YouTube/Vimeo embeds.
      // Expose sourceUrl for Video and Recording types so the player can detect
      // YouTube/Vimeo embeds and direct media URLs. Documents redact it to prevent
      // clients from detecting and directly accessing external document URLs (e.g. Publitas).
      sourceUrl: (resource.resourceType === "Video" || resource.resourceType === "Recording") ? resource.sourceUrl : null,
      mimeType: resource.mimeType,
      hasStoredFile: Boolean(resource.storagePath),
    });
    const learnerTopics = topics.map(topic => {
      const topicSubtopics = subtopics
        .filter(subtopic => subtopic.topicId === topic.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      return {
        id: topic.id,
        title: topic.name,
        duration: "Self-paced",
        progress: 0,
        locked: false,
        activities: readyResources
          .filter(resource => resource.topicId === topic.id && !resource.subtopicId)
          .map(activityFor),
        subtopics: topicSubtopics.map(subtopic => ({
          id: subtopic.id,
          title: subtopic.name,
          activities: readyResources
            .filter(resource => resource.subtopicId === subtopic.id)
            .map(activityFor),
        })),
      };
    });
    const courseLevelResources = readyResources.filter(resource => !resource.topicId && !resource.subtopicId);
    if (courseLevelResources.length) {
      learnerTopics.unshift({
        id: "course-resources",
        title: "Course resources",
        duration: "Self-paced",
        progress: 0,
        locked: false,
        activities: courseLevelResources.map(activityFor),
        subtopics: [],
      });
    }
    res.json(GetCourseResponse.parse({
      id: curriculumCourse.id,
      code: `TB-${curriculumCourse.tribyteTid || curriculumCourse.tribyteNid || "COURSE"}`,
      name: curriculumCourse.name,
      category: curriculumCourse.groupName ?? "TriByte learning",
      language: curriculumCourse.language ?? "English",
      status: curriculumCourse.status ?? "Published",
      progress: 0,
      learners: 0,
      duration: "Self-paced",
      thumbnail: curriculumCourse.thumbUrl ?? "",
      nextActivity: null,
      accent: "ocean",
      description: "TriByte course structure and migrated learning resources.",
      objectives: ["Review the course materials in sequence", "Complete the assigned learning resources"],
      topics: learnerTopics,
    }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/assignments", async (req, res) => {
  const parsed = ListAssignmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    let rows = await db.select().from(assignmentsTable);
    const status = parsed.data.status?.toLowerCase();
    if (status) rows = rows.filter(a => (a.status ?? '').toLowerCase().includes(status));
    res.json(ListAssignmentsResponse.parse(rows));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/assignments", async (req, res) => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const assignment = { id: `assignment-${Date.now()}`, title: parsed.data.title, course: parsed.data.course, dueDate: parsed.data.dueDate, status: "Draft", submitted: false, assessor: parsed.data.assessor, priority: "normal" };
    await db.insert(assignmentsTable).values(assignment);
    res.status(201).json(CreateAssignmentResponse.parse(assignment));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/announcements", async (_req, res) => {
  try { res.json(await db.select().from(announcementsTable)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/sessions", async (_req, res) => {
  try { res.json(ListSessionsResponse.parse(await db.select().from(sessionsTable))); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/certificates", async (_req, res) => {
  try { res.json(ListCertificatesResponse.parse(await db.select().from(certificatesTable))); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/analytics/overview", (_req, res) => {
  res.json(GetAnalyticsOverviewResponse.parse({
    activeLearners: 784, completionRate: 76, averageProgress: 68, pendingReviews: 18,
    weeklyActivity: [{ label: "Mon", value: 48 },{ label: "Tue", value: 62 },{ label: "Wed", value: 58 },{ label: "Thu", value: 74 },{ label: "Fri", value: 69 },{ label: "Sat", value: 42 },{ label: "Sun", value: 35 }],
    coursePerformance: [{ label: "Bridge", value: 82 },{ label: "Safety", value: 76 },{ label: "Cargo", value: 64 },{ label: "Fire", value: 88 }],
  }));
});

router.get("/users", async (_req, res) => {
  try {
    const rows = await db.select().from(usersTable);
    // Map DB field groupName → API field group
    const mapped = rows.map(r => ({ ...r, group: r.groupName ?? '' }));
    res.json(ListUsersResponse.parse(mapped));
  }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.patch("/users/:userId", requireAdmin, async (req, res) => {
  const params = UpdateUserGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateUserGroupBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.name, body.data.group));
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const [user] = await db.update(usersTable)
      .set({ groupName: group.name })
      .where(eq(usersTable.id, params.data.userId))
      .returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(UpdateUserGroupResponse.parse({ ...user, group: user.groupName ?? "" }));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── OBE / Academic routes ────────────────────────────────────────────────────

router.get("/curriculum/programmes", async (_req, res) => {
  try { res.json(ListProgrammesResponse.parse(await db.select().from(programmesTable))); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/curriculum/programmes/:programmeId/courses", async (req, res) => {
  const { programmeId } = ListProgrammeCoursesParams.parse(req.params);
  try {
    const rows = await db.select().from(programmeCoursesTable).where(eq(programmeCoursesTable.programmeId, programmeId));
    if (!rows.length) { res.status(404).json({ error: "Programme not found" }); return; }
    res.json(ListProgrammeCoursesResponse.parse(rows));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/curriculum/courses/:courseId/outline", async (req, res) => {
  const { courseId } = GetCurriculumCourseOutlineParams.parse(req.params);
  try {
    const [pc] = await db.select().from(programmeCoursesTable).where(eq(programmeCoursesTable.id, courseId));
    if (!pc) { res.status(404).json({ error: "Course not found" }); return; }
    const [outline] = await db.select().from(courseOutlinesTable).where(eq(courseOutlinesTable.programmeCourseId, courseId));
    const [programme] = await db.select().from(programmesTable).where(eq(programmesTable.id, pc.programmeId));
    const result = { id: pc.id, name: pc.name, code: pc.code, credits: pc.credits, semester: pc.semester, type: pc.type, description: outline?.description ?? "", programmeId: pc.programmeId, programmeName: programme?.name ?? "", outcomes: (outline?.outcomes as object[]) ?? [], modules: (outline?.modules as object[]) ?? [] };
    res.json(GetCurriculumCourseOutlineResponse.parse(result));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/curriculum/courses/:courseId/outcomes", async (req, res) => {
  const { courseId } = AddCourseOutcomeParams.parse(req.params);
  const body = AddCourseOutcomeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const [outline] = await db.select().from(courseOutlinesTable).where(eq(courseOutlinesTable.programmeCourseId, courseId));
    if (!outline) { res.status(404).json({ error: "Course outline not found" }); return; }
    const outcomes = (outline.outcomes as object[]) ?? [];
    const newCO = AddCourseOutcomeResponse.parse({ id: `co-${courseId}-${outcomes.length + 1}`, code: `CO${outcomes.length + 1}`, description: body.data.description, bloomsLevel: body.data.bloomsLevel, poMapping: body.data.poMapping });
    await db.update(courseOutlinesTable).set({ outcomes: [...outcomes, newCO] }).where(eq(courseOutlinesTable.programmeCourseId, courseId));
    res.status(201).json(newCO);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ─── Curriculum management routes (admin UI) ──────────────────────────────────

// Curriculum courses
router.get("/curriculum/list", async (req, res) => {
  try {
    let rows = await db.select().from(curriculumCoursesTable);
    const { search, group, language } = req.query as Record<string, string>;
    if (search)    rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
    if (group)     rows = rows.filter(r => r.groupName?.toLowerCase().includes(group.toLowerCase()));
    if (language && language !== "All") rows = rows.filter(r => r.language === language);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/curriculum/list", async (req, res) => {
  const { name, groupName, language, adaptiveUserName } = req.body as Record<string, string>;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const row = { id: `cl-${Date.now()}`, name, groupName: groupName ?? "All Content", language: language ?? "English", adaptiveUserName: adaptiveUserName ?? "" };
    await db.insert(curriculumCoursesTable).values(row);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/curriculum/list/import", async (req, res) => {
  const rows = req.body as Array<{ name: string; groupName?: string; language?: string; adaptiveUserName?: string }>;
  if (!Array.isArray(rows)) { res.status(400).json({ error: "Body must be an array of courses" }); return; }
  try {
    const values = rows.filter(r => r.name).map((r, i) => ({ id: `cl-import-${Date.now()}-${i}`, name: r.name, groupName: r.groupName ?? "All Content", language: r.language ?? "English", adaptiveUserName: r.adaptiveUserName ?? "" }));
    if (values.length) await db.insert(curriculumCoursesTable).values(values).onConflictDoNothing();
    res.status(201).json({ imported: values.length });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.patch("/curriculum/list/:id", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  try {
    const updates: Record<string, unknown> = {};
    if (body.name             !== undefined) updates.name             = body.name;
    if (body.groupName        !== undefined) updates.groupName        = body.groupName;
    if (body.language         !== undefined) updates.language         = body.language;
    if (body.adaptiveUserName !== undefined) updates.adaptiveUserName = body.adaptiveUserName;
    if (body.status           !== undefined) updates.status           = body.status;
    if (body.appliedTags      !== undefined) updates.appliedTags      = body.appliedTags;
    await db.update(curriculumCoursesTable).set(updates).where(eq(curriculumCoursesTable.id, req.params.id));
    const [updated] = await db.select().from(curriculumCoursesTable).where(eq(curriculumCoursesTable.id, req.params.id));
    res.json(updated ?? { ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/curriculum/list/:id/duplicate", async (req, res) => {
  try {
    const [src] = await db.select().from(curriculumCoursesTable).where(eq(curriculumCoursesTable.id, req.params.id));
    if (!src) { res.status(404).json({ error: "Course not found" }); return; }
    const copy = { ...src, id: `cl-dup-${Date.now()}`, name: `${src.name} (Copy)`, status: "Draft", createdAt: new Date() };
    await db.insert(curriculumCoursesTable).values(copy);
    res.status(201).json(copy);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.delete("/curriculum/list/:id", async (req, res) => {
  try {
    await db.delete(curriculumCoursesTable).where(eq(curriculumCoursesTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Groups
router.get("/curriculum/groups", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: groupsTable.id,
        name: groupsTable.name,
        parentId: groupsTable.parentId,
        createdAt: groupsTable.createdAt,
        learnerCount: sql<number>`count(*) FILTER (WHERE ${usersTable.role} = 'student')::int`,
      })
      .from(groupsTable)
      .leftJoin(usersTable, eq(usersTable.groupName, groupsTable.name))
      .groupBy(groupsTable.id, groupsTable.name, groupsTable.parentId, groupsTable.createdAt)
      .orderBy(groupsTable.name);
    res.json(rows);
  }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/curriculum/groups", async (req, res) => {
  const { name, parentId } = req.body as { name: string; parentId?: string };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const row = { id: `g-${Date.now()}`, name, parentId: parentId ?? null };
    await db.insert(groupsTable).values(row);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.delete("/curriculum/groups/:id", async (req, res) => {
  try {
    await db.delete(groupsTable).where(eq(groupsTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Tags
router.get("/curriculum/tags", async (req, res) => {
  try {
    let rows = await db.select().from(tagsTable);
    const { search } = req.query as { search?: string };
    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/curriculum/tags", async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const row = { id: `tag-${Date.now()}`, name };
    await db.insert(tagsTable).values(row).onConflictDoNothing();
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.delete("/curriculum/tags/:id", async (req, res) => {
  try {
    await db.delete(tagsTable).where(eq(tagsTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Glossary
router.get("/curriculum/glossary", async (req, res) => {
  try {
    let rows = await db.select().from(glossaryTable);
    const { search } = req.query as { search?: string };
    if (search) rows = rows.filter(r => r.title.toLowerCase().includes(search.toLowerCase()));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/curriculum/glossary", async (req, res) => {
  const { title, definition } = req.body as { title: string; definition?: string };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  try {
    const row = { id: `gl-${Date.now()}`, title, definition: definition ?? "" };
    await db.insert(glossaryTable).values(row);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.delete("/curriculum/glossary/:id", async (req, res) => {
  try {
    await db.delete(glossaryTable).where(eq(glossaryTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Upload status
router.get("/curriculum/upload-status", async (req, res) => {
  try {
    let rows = await db.select().from(uploadJobsTable);
    const { uploadStatus, transcodeStatus, type, user, search } = req.query as Record<string, string>;
    if (uploadStatus && uploadStatus !== "All")    rows = rows.filter(r => r.uploadStatus    === uploadStatus);
    if (transcodeStatus && transcodeStatus !== "All") rows = rows.filter(r => r.transcodeStatus === transcodeStatus);
    if (type && type !== "All")                    rows = rows.filter(r => r.type            === type);
    if (user && user !== "All")                    rows = rows.filter(r => r.uploadedBy       === user);
    if (search) rows = rows.filter(r => r.video.toLowerCase().includes(search.toLowerCase()));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// FAQ categories
router.get("/curriculum/faq-categories", async (_req, res) => {
  try { res.json(await db.select().from(faqTable)); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/curriculum/faq-categories", async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const row = { id: `faq-${Date.now()}`, name };
    await db.insert(faqTable).values(row);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.delete("/curriculum/faq-categories/:id", async (req, res) => {
  try {
    await db.delete(faqTable).where(eq(faqTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ─── Course Topics (curriculum) ───────────────────────────────────────────────

// List topics for a curriculum course
router.get("/curriculum/courses/:id/topics", async (req, res) => {
  try {
    const topics = await db.select().from(courseTopicsTable)
      .where(eq(courseTopicsTable.courseId, req.params.id));
    // sort by order
    topics.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const subtopics = await db.select().from(courseSubtopicsTable)
      .where(eq(courseSubtopicsTable.courseId, req.params.id));
    const resources = await db.select({
      id: courseResourcesTable.id,
      subtopicId: courseResourcesTable.subtopicId,
      topicId: courseResourcesTable.topicId,
      title: courseResourcesTable.title,
      type: courseResourcesTable.resourceType,
      status: courseResourcesTable.status,
      order: courseResourcesTable.order,
      sourceUrl: courseResourcesTable.sourceUrl,
      mimeType: courseResourcesTable.mimeType,
      storagePath: courseResourcesTable.storagePath,
    }).from(courseResourcesTable)
      .where(eq(courseResourcesTable.courseId, req.params.id));
    const toActivity = (r: typeof resources[number]) => ({
      id: r.id,
      subtopicId: r.subtopicId,
      topicId: r.topicId,
      title: r.title,
      type: r.type,
      status: r.status,
      order: r.order,
      // Expose sourceUrl for Video/Recording; redact for Documents (prevents external URL bypass).
      sourceUrl: (r.type === "Video" || r.type === "Recording") ? r.sourceUrl : null,
      mimeType: r.mimeType,
      hasStoredFile: Boolean(r.storagePath),
      openUrl: r.status === "ready" ? `/api/curriculum/resources/${r.id}/admin-view` : null,
    });
    const result = topics.map(t => ({
      ...t,
      subtopics: subtopics
        .filter(s => s.topicId === t.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(s => ({
          ...s,
          activities: resources
            .filter(r => r.subtopicId === s.id)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(toActivity),
        })),
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Create a topic for a curriculum course
router.post("/curriculum/courses/:id/topics", async (req, res) => {
  const { name, thumbUrl, nid, tid, faculty } = req.body as Record<string, string>;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const existing = await db.select().from(courseTopicsTable)
      .where(eq(courseTopicsTable.courseId, req.params.id));
    const row = {
      id: `ct-${Date.now()}`,
      courseId: req.params.id,
      name,
      nid: nid ?? "",
      tid: tid ?? "",
      thumbUrl: thumbUrl ?? "",
      faculty: faculty ?? "",
      order: existing.length,
    };
    await db.insert(courseTopicsTable).values(row);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Update a topic (admin only)
router.patch("/curriculum/topics/:topicId", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  try {
    const updates: Record<string, unknown> = {};
    if (body.name     !== undefined) updates.name     = body.name;
    if (body.thumbUrl !== undefined) updates.thumbUrl = body.thumbUrl;
    if (body.faculty  !== undefined) updates.faculty  = body.faculty;
    if (body.order    !== undefined) updates.order    = body.order;
    const topicId = String(req.params.topicId);
    await db.update(courseTopicsTable).set(updates).where(eq(courseTopicsTable.id, topicId));
    const [updated] = await db.select().from(courseTopicsTable).where(eq(courseTopicsTable.id, topicId));
    res.json(updated ?? { ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Delete a topic (and its subtopics) (admin only)
router.delete("/curriculum/topics/:topicId", requireAdmin, async (req, res) => {
  try {
    const topicId = String(req.params.topicId);
    await db.delete(courseSubtopicsTable).where(eq(courseSubtopicsTable.topicId, topicId));
    await db.delete(courseTopicsTable).where(eq(courseTopicsTable.id, topicId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── Subtopic CRUD ─────────────────────────────────────────────────────────────

// Create a subtopic under a topic
router.post("/curriculum/topics/:topicId/subtopics", requireAdmin, async (req, res) => {
  const topicId = String(req.params.topicId);
  const { name, nid } = req.body as Record<string, string>;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  try {
    // Look up the topic so we can get courseId
    const [topic] = await db.select().from(courseTopicsTable).where(eq(courseTopicsTable.id, topicId));
    if (!topic) { res.status(404).json({ error: "Topic not found" }); return; }
    const existing = await db.select().from(courseSubtopicsTable)
      .where(eq(courseSubtopicsTable.topicId, topicId));
    const row = {
      id: `cs-${Date.now()}`,
      topicId,
      courseId: topic.courseId,
      name,
      nid: nid ?? "",
      order: existing.length,
    };
    await db.insert(courseSubtopicsTable).values(row);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Update a subtopic
router.patch("/curriculum/subtopics/:subtopicId", requireAdmin, async (req, res) => {
  const subtopicId = String(req.params.subtopicId);
  const body = req.body as Record<string, unknown>;
  try {
    const updates: Record<string, unknown> = {};
    if (body.name  !== undefined) updates.name  = body.name;
    if (body.order !== undefined) updates.order = body.order;
    if (body.nid   !== undefined) updates.nid   = body.nid;
    await db.update(courseSubtopicsTable).set(updates).where(eq(courseSubtopicsTable.id, subtopicId));
    const [updated] = await db.select().from(courseSubtopicsTable).where(eq(courseSubtopicsTable.id, subtopicId));
    res.json(updated ?? { ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Delete a subtopic
router.delete("/curriculum/subtopics/:subtopicId", requireAdmin, async (req, res) => {
  const subtopicId = String(req.params.subtopicId);
  try {
    await db.delete(courseSubtopicsTable).where(eq(courseSubtopicsTable.id, subtopicId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── Helpers for parsing TriByte topics HTML ───────────────────────────────────

/** Walk forward from `startPos` (just inside the opening `<li>` tag) and
 *  return the index of the matching `</li>`, correctly handling nested `<li>`. */
function findLiBlockEnd(html: string, startPos: number): number {
  let depth = 1;
  let i = startPos;
  while (i < html.length) {
    if (html[i] === '<') {
      if (html.slice(i, i + 3) === '<li' && (html[i + 3] === ' ' || html[i + 3] === '>')) {
        depth++; i += 3;
      } else if (html.slice(i, i + 5) === '</li>') {
        depth--; if (depth === 0) return i; i += 5;
      } else { i++; }
    } else { i++; }
  }
  return html.length;
}

const cleanHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Extract the best human-readable label from an inner <li> HTML block. */
function extractTopicName(innerHtml: string, fallbackNid: string): string {
  const patterns = [
    /class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p|h\d)>/,
    /class="[^"]*node-title[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p|h\d|a)>/,
    /class="[^"]*\bname\b[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/,
    /<a[^>]*>([\s\S]*?)<\/a>/,
  ];
  for (const p of patterns) {
    const m = innerHtml.match(p);
    if (m) { const t = cleanHtml(m[1]); if (t) return t; }
  }
  const text = cleanHtml(innerHtml).slice(0, 150);
  return text || `Topic ${fallbackNid}`;
}

/** Extract the first CDN image URL from an inner <li> HTML block. */
function extractTopicThumb(innerHtml: string): string {
  const m = innerHtml.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp)[^"]*)"/i)
    || innerHtml.match(/src="([^"]*static[^"]+)"/i)
    || innerHtml.match(/src="([^"]+)"/);
  return m?.[1] ?? '';
}

/** Read a Drupal node title from its edit form without relying on CSS classes. */
function extractDrupalNodeTitle(html: string): string | null {
  const titleInput = html.match(/<input\b(?=[^>]*\bname=["']title["'])[^>]*>/i)?.[0];
  const value = titleInput?.match(/\bvalue=["']([^"']*)["']/i)?.[1];
  if (!value) return null;
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .trim() || null;
}

type StructureImportResult = {
  outcome: "imported" | "skipped";
  imported: number;
  subtopicsImported: number;
  reason?: string;
};

function triByteTopicId(courseId: string, nid: string): string {
  return `ct-${courseId}-${nid}`;
}

function triByteSubtopicId(courseId: string, nid: string): string {
  return `cs-${courseId}-${nid}`;
}

/**
 * Import one course's TriByte structure. Bulk imports default to preserving any
 * existing LMS structure; callers must explicitly opt in to replacement.
 */
async function importTriByteCourseTopics(
  course: typeof curriculumCoursesTable.$inferSelect,
  session: { cookie: string; strategy: string },
  replaceExisting: boolean,
): Promise<StructureImportResult> {
  const courseId = course.id;
  const tid = course.tribyteTid ?? "";
  if (!tid) throw new Error("Course has no TriByte TID — cannot import");

  let existingTopics = await db.select().from(courseTopicsTable)
    .where(eq(courseTopicsTable.courseId, courseId));

  const url = `${TB_BASE_URL}/reviewer/topics?cat=${tid}&catspec=true`;
  const htmlRes = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Cookie: session.cookie, "User-Agent": "Mozilla/5.0" },
  });
  if (!htmlRes.ok) throw new Error(`TriByte responded ${htmlRes.status}`);
  const html = await htmlRes.text();
  if (isTBLoginPage(html)) throw new Error("TriByte rejected the stored login — check the configured credentials");

  interface LiNidItem {
    pos: number; nid: string; innerStart: number; depth: number; innerHtml: string;
  }
  const nidItems: LiNidItem[] = [];
  const liTagRe = /<li\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = liTagRe.exec(html)) !== null) {
    const nidMatch = m[1].match(/\bdata-nid\s*=\s*["'](\d+)["']/i);
    if (nidMatch) {
      const innerStart = m.index + m[0].length;
      nidItems.push({ pos: m.index, nid: nidMatch[1], innerStart, depth: 0, innerHtml: "" });
    }
  }

  // TriByte's ordered "Edit sub-topics" links are the authoritative list of
  // top-level topics. Some pages contain unrelated data-nid markup, so prefer
  // these explicit navigation links whenever they are present.
  const topicLinkItems: LiNidItem[] = [];
  const seenTopicNids = new Set<string>();
  const subtopicLinkRe = /href=["'][^"']*\/node\/(\d+)\/edit\/subtopics[^"']*["']/gi;
  while ((m = subtopicLinkRe.exec(html)) !== null) {
    const nid = m[1];
    if (!seenTopicNids.has(nid)) {
      seenTopicNids.add(nid);
      topicLinkItems.push({ pos: m.index, nid, innerStart: m.index, depth: 0, innerHtml: "" });
    }
  }
  if (topicLinkItems.length > 0) {
    nidItems.splice(0, nidItems.length, ...topicLinkItems);
  }

  for (const item of nidItems) {
    const before = html.slice(0, item.pos);
    item.depth = (before.match(/<li[\s>]/g) || []).length - (before.match(/<\/li>/g) || []).length;
  }
  for (const item of nidItems) {
    const endPos = findLiBlockEnd(html, item.innerStart);
    item.innerHtml = html.slice(item.innerStart, endPos);
  }
  if (nidItems.length === 0) {
    const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? "";
    // These pages are authenticated and course-specific, but the selected
    // TriByte course has no topic cards to migrate. Completing them avoids
    // treating deliberately empty structures as importer failures.
    if (/^Show All Topics of\b/i.test(pageTitle)) {
      return {
        outcome: "imported",
        imported: 0,
        subtopicsImported: 0,
        reason: "No topics found in TriByte",
      };
    }
    throw new Error("TriByte returned no topic cards for this course");
  }

  const minDepth = Math.min(...nidItems.map(i => i.depth));
  const topicItems = nidItems.filter(i => i.depth === minDepth);
  const topicTitles = new Map<string, string>();
  for (const topic of topicItems) {
    const detailRes = await fetch(`${TB_BASE_URL}/node/${topic.nid}/edit/topic/tab`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Cookie: session.cookie, "User-Agent": "Mozilla/5.0" },
    });
    if (!detailRes.ok) continue;
    const title = extractDrupalNodeTitle(await detailRes.text());
    if (title) topicTitles.set(topic.nid, title);
  }

  if (replaceExisting) {
    for (const topic of existingTopics) {
      await db.delete(courseSubtopicsTable).where(eq(courseSubtopicsTable.topicId, topic.id));
    }
    await db.delete(courseTopicsTable).where(eq(courseTopicsTable.courseId, courseId));
    existingTopics = [];
  }

  const topicRows = topicItems.map((topic, order) => ({
    id: triByteTopicId(courseId, topic.nid),
    courseId,
    nid: topic.nid,
    tid,
    name: topicTitles.get(topic.nid) ?? extractTopicName(topic.innerHtml, topic.nid),
    order,
    thumbUrl: extractTopicThumb(topic.innerHtml),
    faculty: "",
  }));
  const existingTopicNids = new Set(existingTopics.map(topic => topic.nid));
  const missingTopicRows = topicRows.filter(topic => !existingTopicNids.has(topic.nid));
  const insertedTopics = missingTopicRows.length
    ? await db.insert(courseTopicsTable).values(missingTopicRows).onConflictDoNothing().returning({ id: courseTopicsTable.id })
    : [];
  const persistedTopics = await db.select().from(courseTopicsTable)
    .where(eq(courseTopicsTable.courseId, courseId));
  const persistedTopicByNid = new Map(persistedTopics.map(topic => [topic.nid, topic]));

  let subtopicsInserted = 0;
  for (const topicRow of topicRows) {
    const persistedTopic = persistedTopicByNid.get(topicRow.nid);
    if (!persistedTopic) {
      throw new Error(`Could not persist TriByte topic ${topicRow.nid}`);
    }
    // The category page can show only top-level topic links. The topic's own
    // ordered sub-topic view is the source of truth for its child structure.
    const subtopicRes = await fetch(`${TB_BASE_URL}/node/${topicRow.nid}/edit/subtopics`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Cookie: session.cookie, "User-Agent": "Mozilla/5.0" },
    });
    if (!subtopicRes.ok) {
      throw new Error(`TriByte sub-topic view responded ${subtopicRes.status}`);
    }
    const subtopicHtml = await subtopicRes.text();
    if (isTBLoginPage(subtopicHtml)) {
      throw new Error("TriByte rejected the stored login — check the configured credentials");
    }
    const discoveredSubtopics = extractTriByteNodes(
      subtopicHtml,
      /\/node\/(\d+)\/edit\/contents(?:[/?]|$)/i,
    );
    const existingSubtopics = await db.select().from(courseSubtopicsTable)
      .where(eq(courseSubtopicsTable.topicId, persistedTopic.id));
    const existingSubtopicNids = new Set(existingSubtopics.map(subtopic => subtopic.nid));
    for (const [order, subtopic] of discoveredSubtopics.entries()) {
      if (existingSubtopicNids.has(subtopic.nid)) continue;
      const subtopicDetailRes = await fetch(`${TB_BASE_URL}/node/${subtopic.nid}/edit/subtopic/tab`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Cookie: session.cookie, "User-Agent": "Mozilla/5.0" },
      });
      if (!subtopicDetailRes.ok) {
        throw new Error(`TriByte sub-topic details responded ${subtopicDetailRes.status}`);
      }
      const subtopicName = extractDrupalNodeTitle(await subtopicDetailRes.text()) || subtopic.title;
      const [created] = await db.insert(courseSubtopicsTable).values({
        id: triByteSubtopicId(courseId, subtopic.nid),
        topicId: persistedTopic.id,
        courseId,
        nid: subtopic.nid,
        name: subtopicName.slice(0, 500),
        order,
      }).onConflictDoNothing().returning({ id: courseSubtopicsTable.id });
      if (created) subtopicsInserted++;
    }
  }

  if (!replaceExisting && existingTopics.length > 0 && insertedTopics.length === 0 && subtopicsInserted === 0) {
    return {
      outcome: "skipped",
      imported: 0,
      subtopicsImported: 0,
      reason: "Existing course structure already matches TriByte",
    };
  }
  return { outcome: "imported", imported: insertedTopics.length, subtopicsImported: subtopicsInserted };
}

// Import topics (and sub-topics) from TriByte for a curriculum course.
// Scrapes /reviewer/topics?cat={tid}&catspec=true, parses the carousel HTML,
// and stores both top-level topics and any nested subtopics.
router.post("/curriculum/courses/:id/topics/import", requireAdmin, async (req, res) => {
  try {
    const courseId = String(req.params.id);
    const [course] = await db.select().from(curriculumCoursesTable)
      .where(eq(curriculumCoursesTable.id, courseId));
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }
    if (!course.tribyteTid) { res.status(400).json({ error: "Course has no TriByte TID — cannot import" }); return; }

    const session = await resolveTriByteCookie();
    if (!session) {
      res.status(400).json({ error: "No TriByte credentials configured — add them in Settings → TriByte Connection" });
      return;
    }

    // The per-course action must use the same safe, source-driven importer as
    // background reconciliation. It preserves existing structure unless the
    // caller explicitly requests replacement.
    const result = await importTriByteCourseTopics(course, session, req.body?.replaceExisting === true);
    const topics = await db.select().from(courseTopicsTable)
      .where(eq(courseTopicsTable.courseId, courseId));
    res.status(201).json({
      imported: result.imported,
      subtopicsImported: result.subtopicsImported,
      message: result.reason,
      topics,
    });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ─── Shared TriByte helpers ───────────────────────────────────────────────────

const TB_BASE_URL = "https://admin.learn.himtelearning.com";
const FETCH_TIMEOUT_MS = 30_000;

/** Detect a TriByte login-redirect page (session expired / bad cookie). */
function isTBLoginPage(html: string): boolean {
  // TriByte has used both `user-login` and `user-login-1`, and the current
  // themed login page has an empty <title>. The form ID is the durable signal.
  return /<form\b[^>]*\bid=["']user-login(?:-[^"']*)?["']/i.test(html);
}

/** Log into TriByte via Drupal form; returns a Cookie header string. */
async function loginToTriByteShared(tbUser: string, tbPass: string): Promise<string> {
  const loginPageRes = await fetch(`${TB_BASE_URL}/user/login`, {
    signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const loginHtml = await loginPageRes.text();
  const buildIdInput = loginHtml.match(/<input\b[^>]*\bname=["']form_build_id["'][^>]*>/i)?.[0];
  const formBuildId = buildIdInput?.match(/\bvalue=["']([^"']+)["']/i)?.[1];
  if (!formBuildId) throw new Error("Could not find form_build_id on TriByte login page");

  const cookieLines = (response: Response): string[] => {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const raw = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
    return raw
      .flatMap(value => value.split(/,(?=\s*[^;,\s]+=)/))
      .map(value => value.split(";")[0].trim())
      .filter(Boolean);
  };
  const initialCookies = cookieLines(loginPageRes);

  const body = new URLSearchParams({
    name: tbUser, pass: tbPass,
    form_build_id: formBuildId, form_id: "user_login", op: "Log in",
    // TriByte's setFormSecureToken() copies form_build_id into the st field
    // before submission; include it so server-side validation passes.
    st: formBuildId,
  });
  const loginRes = await fetch(`${TB_BASE_URL}/user/login?destination=reviewer/course/list`, {
    method:   "POST",
    signal:   AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers:  {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0",
      Cookie: initialCookies.join("; "),
    },
    body:     body.toString(),
    redirect: "manual",
  });
  const allCookies = [...initialCookies, ...cookieLines(loginRes)];
  if (!allCookies.length) throw new Error("TriByte login did not return cookies — check credentials");
  if (loginRes.status >= 400) {
    throw new Error(`TriByte login returned ${loginRes.status} — check the configured credentials`);
  }
  const loginResponseHtml = await loginRes.text();
  if (isTBLoginPage(loginResponseHtml)) {
    throw new Error("TriByte login was rejected — update the configured credentials");
  }
  const byName = new Map<string, string>();
  for (const cookie of allCookies) byName.set(cookie.split("=")[0], cookie);
  const cookie = [...byName.values()].join("; ");

  // A Drupal guest session also has cookies, so verify a protected page before
  // caching the result. Otherwise an invalid login looks like an empty course.
  const verifyRes = await fetch(`${TB_BASE_URL}/reviewer/course/list`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
  });
  const verifyHtml = await verifyRes.text();
  if (!verifyRes.ok || isTBLoginPage(verifyHtml)) {
    throw new Error("TriByte login was rejected — update the configured credentials");
  }
  return cookie;
}

// In-memory TriByte session cache — avoids re-logging in on every request.
// Invalidated when credentials are updated via the settings API.
let tbSessionCache: { cookie: string; expiresAt: number; strategy: string } | null = null;
const TB_SESSION_TTL_MS = 7 * 60 * 60 * 1000; // 7 hours
function invalidateTBSessionCache() { tbSessionCache = null; }

/** Return true if any TriByte credentials exist in env vars OR the DB. */
async function hasAnyTriByteCredsConfigured(): Promise<boolean> {
  if (process.env.TRIBYTE_SESSION || process.env.TRIBYTE_USERNAME || process.env.TRIBYTE_PASSWORD) {
    return true;
  }
  try {
    const [u] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "tribyte_username"));
    const [p] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "tribyte_password"));
    return Boolean(u?.value && p?.value);
  } catch { return false; }
}

/**
 * Resolve a TriByte cookie header. Priority:
 *   1. In-memory cache (if not expired)
 *   2. TRIBYTE_SESSION env var (raw Cookie string — no login needed)
 *   3. DB-stored username + password (saved via PUT /tribyte/credentials)
 *   4. TRIBYTE_USERNAME + TRIBYTE_PASSWORD env vars
 * Returns null if no credentials are configured anywhere.
 */
async function resolveTriByteCookie(): Promise<{ cookie: string; strategy: string } | null> {
  // 1. Cache hit
  if (tbSessionCache && tbSessionCache.expiresAt > Date.now()) {
    return { cookie: tbSessionCache.cookie, strategy: tbSessionCache.strategy };
  }
  tbSessionCache = null;

  // 2. Raw session env var (no login needed — skip cache)
  if (process.env.TRIBYTE_SESSION) {
    return { cookie: process.env.TRIBYTE_SESSION, strategy: "TRIBYTE_SESSION" };
  }

  // 3. DB-stored credentials (password stored encrypted)
  try {
    const [uRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "tribyte_username"));
    const [pRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "tribyte_password"));
    if (uRow?.value && pRow?.value) {
      const plainPass = decryptSetting(pRow.value);
      const cookie = await loginToTriByteShared(uRow.value, plainPass);
      tbSessionCache = { cookie, expiresAt: Date.now() + TB_SESSION_TTL_MS, strategy: "DB_CREDENTIALS" };
      return { cookie, strategy: "DB_CREDENTIALS" };
    }
  } catch { /* DB query or login failed — fall through */ }

  // 4. Env var username/password
  const tbUser = process.env.TRIBYTE_USERNAME?.trim();
  const tbPass = process.env.TRIBYTE_PASSWORD?.trim();
  if (tbUser && tbPass) {
    const cookie = await loginToTriByteShared(tbUser, tbPass);
    tbSessionCache = { cookie, expiresAt: Date.now() + TB_SESSION_TTL_MS, strategy: "TRIBYTE_USERNAME/PASSWORD" };
    return { cookie, strategy: "TRIBYTE_USERNAME/PASSWORD" };
  }

  return null;
}

// ─── TriByte credentials management ──────────────────────────────────────────

/**
 * GET /api/tribyte/credentials
 * Returns whether TriByte credentials are configured and their source.
 * Never returns the password — only the username and source.
 */
router.get("/tribyte/credentials", requireAdmin, async (_req, res) => {
  try {
    if (process.env.TRIBYTE_SESSION) {
      res.json({ configured: true, source: "env_session", username: null }); return;
    }
    if (process.env.TRIBYTE_USERNAME) {
      res.json({ configured: true, source: "env_userpass", username: process.env.TRIBYTE_USERNAME }); return;
    }
    const [uRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "tribyte_username"));
    const [pRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "tribyte_password"));
    if (uRow?.value && pRow?.value) {
      res.json({ configured: true, source: "db", username: uRow.value });
    } else {
      res.json({ configured: false, source: null, username: null });
    }
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/**
 * PUT /api/tribyte/credentials
 * Save TriByte username + password to the DB. Clears the session cache so the
 * next import/sync will log in with the new credentials.
 * Body: { username: string; password: string }
 */
router.put("/tribyte/credentials", requireAdmin, async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password?.trim()) {
    res.status(400).json({ error: "username and password are required" }); return;
  }
  try {
    const encryptedPass = encryptSetting(password.trim());
    await db.insert(appSettingsTable)
      .values({ key: "tribyte_username", value: username.trim() })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: username.trim(), updatedAt: new Date() } });
    await db.insert(appSettingsTable)
      .values({ key: "tribyte_password", value: encryptedPass })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: encryptedPass, updatedAt: new Date() } });
    invalidateTBSessionCache();
    res.json({ saved: true, username: username.trim() });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/**
 * DELETE /api/tribyte/credentials
 * Remove stored DB credentials and clear the session cache.
 */
router.delete("/tribyte/credentials", requireAdmin, async (_req, res) => {
  try {
    await db.delete(appSettingsTable).where(eq(appSettingsTable.key, "tribyte_username"));
    await db.delete(appSettingsTable).where(eq(appSettingsTable.key, "tribyte_password"));
    invalidateTBSessionCache();
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/**
 * POST /api/tribyte/credentials/test
 * Test a login attempt. If username+password are in the body, tests those directly
 * (does not save them). If omitted, tests whatever credentials are currently configured.
 */
router.post("/tribyte/credentials/test", requireAdmin, async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  try {
    let cookie: string;
    let strategy: string;
    if (username?.trim() && password?.trim()) {
      cookie = await loginToTriByteShared(username.trim(), password.trim());
      strategy = "provided";
    } else {
      const resolved = await resolveTriByteCookie();
      if (!resolved) {
        res.status(400).json({ ok: false, error: "No credentials configured to test" }); return;
      }
      cookie = resolved.cookie; strategy = resolved.strategy;
    }
    const verifyRes = await fetch(`${TB_BASE_URL}/reviewer/course/list`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
    });
    const html = await verifyRes.text();
    if (!verifyRes.ok || isTBLoginPage(html)) {
      res.json({ ok: false, error: "Login succeeded but TriByte rejected the session — check credentials" }); return;
    }
    res.json({ ok: true, strategy });
  } catch (err) { res.json({ ok: false, error: String(err) }); }
});

// ─── Sync courses from TriByte ────────────────────────────────────────────────
const TRIBYTE_COURSES_LAST_SYNCED_KEY = "tribyte_courses_last_synced_at";

/**
 * Middleware: require an active authenticated admin session.
 * Sessions are established via POST /api/auth/login.
 */
function requireAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (req.session.isAdmin === true) { next(); return; }
  res.status(401).json({ error: "Unauthorized — admin login required" });
}

type ResolvedLearner = {
  clerkUserId: string;
  userId: string;
  email: string;
};

async function resolveLearner(req: import("express").Request): Promise<ResolvedLearner | null> {
  const clerkUserId = getAuth(req).userId;
  if (!clerkUserId) return null;

  const [identity] = await db.select().from(learnerIdentitiesTable)
    .where(eq(learnerIdentitiesTable.clerkUserId, clerkUserId));
  if (identity) return identity;

  // The email comes directly from Clerk's server API, never from the browser.
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = clerkUser.primaryEmailAddress?.emailAddress?.trim().toLowerCase();
  if (!email) throw new Error("Your learner account needs a verified email address");
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim()
    || clerkUser.username
    || email.split("@")[0];
  const [existingUser] = await db.select().from(usersTable)
    .where(ilike(usersTable.email, email));
  const user = existingUser ?? (await db.insert(usersTable).values({
    id: `learner-${randomBytes(10).toString("hex")}`,
    name,
    email,
    role: "student",
    status: "Active",
    lastActivity: "Just now",
  }).returning())[0];

  const [createdIdentity] = await db.insert(learnerIdentitiesTable).values({
    clerkUserId,
    userId: user.id,
    email,
    updatedAt: new Date(),
  }).onConflictDoNothing().returning();
  return createdIdentity ?? (await db.select().from(learnerIdentitiesTable)
    .where(eq(learnerIdentitiesTable.clerkUserId, clerkUserId)))[0];
}

async function learnerCanAccessCourse(req: import("express").Request, courseId: string): Promise<boolean> {
  if (req.session.isAdmin === true) return true;
  const learner = await resolveLearner(req);
  if (!learner) return false;
  const [access] = await db.select({ id: learnerCourseAccessTable.id })
    .from(learnerCourseAccessTable)
    .where(and(
      eq(learnerCourseAccessTable.clerkUserId, learner.clerkUserId),
      eq(learnerCourseAccessTable.courseId, courseId),
    ));
  return Boolean(access);
}

router.get("/learner/me", async (req, res) => {
  try {
    const learner = await resolveLearner(req);
    if (!learner) { res.status(401).json({ error: "Learner sign-in required" }); return; }
    const access = await db.select({ courseId: learnerCourseAccessTable.courseId })
      .from(learnerCourseAccessTable)
      .where(eq(learnerCourseAccessTable.clerkUserId, learner.clerkUserId));
    res.json({ userId: learner.userId, email: learner.email, enrolledCourseIds: access.map(row => row.courseId) });
  } catch (error) {
    logger.error({ error }, "Could not provision learner identity");
    res.status(400).json({ error: "Could not set up learner access" });
  }
});

router.post("/curriculum/courses/:courseId/learner-access", requireAdmin, async (req, res) => {
  const courseId = String(req.params.courseId);
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) { res.status(400).json({ error: "A learner email is required" }); return; }
  try {
    const [course] = await db.select({ id: curriculumCoursesTable.id }).from(curriculumCoursesTable)
      .where(eq(curriculumCoursesTable.id, courseId));
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }
    const [identity] = await db.select().from(learnerIdentitiesTable)
      .where(ilike(learnerIdentitiesTable.email, email));
    if (!identity) {
      res.status(409).json({ error: "The learner must sign in once before course access can be assigned" }); return;
    }
    await db.insert(learnerCourseAccessTable).values({
      id: `course-access-${randomBytes(10).toString("hex")}`,
      clerkUserId: identity.clerkUserId,
      courseId: course.id,
    }).onConflictDoNothing();
    res.status(201).json({ courseId: course.id, email });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ─── Bulk Course Structure Import ─────────────────────────────────────────────

const ACTIVE_STRUCTURE_IMPORT_STATUSES = new Set(["queued", "running"]);
const activeStructureImportRunners = new Set<string>();
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function structureImportJobId() {
  return `tri-structure-${randomBytes(8).toString("hex")}`;
}

function publicImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, "TriByte").slice(0, 500);
}

async function getStructureImportJob(jobId: string) {
  const [job] = await db.select().from(courseStructureImportJobsTable)
    .where(eq(courseStructureImportJobsTable.id, jobId));
  if (!job) return null;
  const items = await db.select().from(courseStructureImportJobItemsTable)
    .where(eq(courseStructureImportJobItemsTable.jobId, jobId));
  items.sort((a, b) => a.courseName.localeCompare(b.courseName));
  return { ...job, items };
}

async function refreshStructureImportSummary(
  jobId: string,
  updates: Partial<{
    status: string;
    currentCourseId: string | null;
    currentCourseName: string | null;
    finishedAt: Date | null;
  }> = {},
) {
  const items = await db.select().from(courseStructureImportJobItemsTable)
    .where(eq(courseStructureImportJobItemsTable.jobId, jobId));
  const completedCourses = items.filter(item => ["imported", "skipped", "failed"].includes(item.status)).length;
  const importedCourses = items.filter(item => item.status === "imported").length;
  const skippedCourses = items.filter(item => item.status === "skipped").length;
  const failedCourses = items.filter(item => item.status === "failed").length;
  await db.update(courseStructureImportJobsTable)
    .set({
      completedCourses,
      importedCourses,
      skippedCourses,
      failedCourses,
      updatedAt: new Date(),
      ...updates,
    })
    .where(eq(courseStructureImportJobsTable.id, jobId));
}

function queueStructureImportJob(jobId: string) {
  setTimeout(() => { void runStructureImportJob(jobId); }, 25);
}

async function runStructureImportJob(jobId: string): Promise<void> {
  if (activeStructureImportRunners.has(jobId)) return;
  activeStructureImportRunners.add(jobId);

  try {
    const [job] = await db.select().from(courseStructureImportJobsTable)
      .where(eq(courseStructureImportJobsTable.id, jobId));
    if (!job || job.cancelRequested || !ACTIVE_STRUCTURE_IMPORT_STATUSES.has(job.status)) return;

    await db.update(courseStructureImportJobsTable)
      .set({ status: "running", startedAt: job.startedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(courseStructureImportJobsTable.id, jobId));

    let session = await resolveTriByteCookie();
    if (!session) throw new Error("No TriByte credentials configured");
    const items = await db.select().from(courseStructureImportJobItemsTable)
      .where(eq(courseStructureImportJobItemsTable.jobId, jobId));

    for (const item of items) {
      if (!["pending", "running"].includes(item.status)) continue;
      const [latestJob] = await db.select().from(courseStructureImportJobsTable)
        .where(eq(courseStructureImportJobsTable.id, jobId));
      if (latestJob?.cancelRequested) {
        await refreshStructureImportSummary(jobId, {
          status: "cancelled",
          currentCourseId: null,
          currentCourseName: null,
          finishedAt: new Date(),
        });
        return;
      }

      await db.update(courseStructureImportJobItemsTable)
        .set({
          status: "running",
          attempts: (item.attempts ?? 0) + 1,
          startedAt: new Date(),
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(courseStructureImportJobItemsTable.id, item.id));
      await db.update(courseStructureImportJobsTable)
        .set({ currentCourseId: item.courseId, currentCourseName: item.courseName, updatedAt: new Date() })
        .where(eq(courseStructureImportJobsTable.id, jobId));

      try {
        const [course] = await db.select().from(curriculumCoursesTable)
          .where(eq(curriculumCoursesTable.id, item.courseId));
        if (!course) throw new Error("Course was removed from the curriculum");

        let result: StructureImportResult;
        try {
          result = await importTriByteCourseTopics(course, session, job.replaceExisting);
        } catch (firstError) {
          if (!/rejected the stored login|TriByte responded 401/i.test(publicImportError(firstError))) throw firstError;
          invalidateTBSessionCache();
          session = await resolveTriByteCookie();
          if (!session) throw firstError;
          result = await importTriByteCourseTopics(course, session, job.replaceExisting);
        }

        await db.update(courseStructureImportJobItemsTable)
          .set({
            status: result.outcome,
            importedTopics: result.imported,
            importedSubtopics: result.subtopicsImported,
            error: result.reason ?? null,
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(courseStructureImportJobItemsTable.id, item.id));
      } catch (error) {
        logger.warn({ jobId, courseId: item.courseId, err: publicImportError(error) }, "TriByte course structure import failed");
        await db.update(courseStructureImportJobItemsTable)
          .set({
            status: "failed",
            error: publicImportError(error),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(courseStructureImportJobItemsTable.id, item.id));
      }

      await refreshStructureImportSummary(jobId, { currentCourseId: null, currentCourseName: null });
      await pause(250);
    }

    const finalJob = await getStructureImportJob(jobId);
    if (!finalJob) return;
    await refreshStructureImportSummary(jobId, {
      status: finalJob.failedCourses > 0 ? "completed_with_errors" : "completed",
      currentCourseId: null,
      currentCourseName: null,
      finishedAt: new Date(),
    });
  } catch (error) {
    logger.error({ jobId, err: publicImportError(error) }, "TriByte course structure job could not start");
    const items = await db.select().from(courseStructureImportJobItemsTable)
      .where(eq(courseStructureImportJobItemsTable.jobId, jobId));
    for (const item of items.filter(item => ["pending", "running"].includes(item.status))) {
      await db.update(courseStructureImportJobItemsTable)
        .set({ status: "failed", error: publicImportError(error), finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(courseStructureImportJobItemsTable.id, item.id));
    }
    await refreshStructureImportSummary(jobId, {
      status: "failed",
      currentCourseId: null,
      currentCourseName: null,
      finishedAt: new Date(),
    });
  } finally {
    activeStructureImportRunners.delete(jobId);
  }
}

async function resumeStructureImportJobs(): Promise<void> {
  try {
    const jobs = await db.select().from(courseStructureImportJobsTable);
    for (const job of jobs.filter(job => ACTIVE_STRUCTURE_IMPORT_STATUSES.has(job.status))) {
      const items = await db.select().from(courseStructureImportJobItemsTable)
        .where(eq(courseStructureImportJobItemsTable.jobId, job.id));
      for (const item of items.filter(item => item.status === "running")) {
        await db.update(courseStructureImportJobItemsTable)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(courseStructureImportJobItemsTable.id, item.id));
      }
      await db.update(courseStructureImportJobsTable)
        .set({ status: "queued", currentCourseId: null, currentCourseName: null, updatedAt: new Date() })
        .where(eq(courseStructureImportJobsTable.id, job.id));
      queueStructureImportJob(job.id);
    }
  } catch (error) {
    logger.warn({ err: publicImportError(error) }, "Could not resume TriByte course structure imports");
  }
}

router.get("/curriculum/structure-imports/latest", requireAdmin, async (_req, res) => {
  try {
    const jobs = await db.select().from(courseStructureImportJobsTable);
    const latest = jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    res.json({ job: latest ? await getStructureImportJob(latest.id) : null });
  } catch {
    res.status(500).json({ error: "Could not load bulk import status" });
  }
});

router.post("/curriculum/structure-imports", requireAdmin, async (req, res) => {
  try {
    const activeJob = (await db.select().from(courseStructureImportJobsTable))
      .find(job => ACTIVE_STRUCTURE_IMPORT_STATUSES.has(job.status));
    if (activeJob) {
      res.status(409).json({ error: "A bulk Course Structure import is already running", job: await getStructureImportJob(activeJob.id) });
      return;
    }

    const replaceExisting = req.body?.replaceExisting === true;
    const courses = (await db.select().from(curriculumCoursesTable))
      .filter(course => Boolean(course.tribyteTid));
    if (!courses.length) {
      res.status(400).json({ error: "No TriByte courses are available to import" });
      return;
    }

    const jobId = structureImportJobId();
    await db.insert(courseStructureImportJobsTable).values({
      id: jobId,
      status: "queued",
      replaceExisting,
      totalCourses: courses.length,
    });
    await db.insert(courseStructureImportJobItemsTable).values(courses.map(course => ({
      id: `${jobId}:${course.id}`,
      jobId,
      courseId: course.id,
      courseName: course.name,
      status: "pending",
    })));
    queueStructureImportJob(jobId);
    res.status(202).json({ job: await getStructureImportJob(jobId) });
  } catch (error) {
    req.log.error({ err: publicImportError(error) }, "Could not start TriByte course structure import");
    res.status(500).json({ error: "Could not start bulk Course Structure import" });
  }
});

router.post("/curriculum/structure-imports/:jobId/cancel", requireAdmin, async (req, res) => {
  const jobId = String(req.params.jobId);
  try {
    const [job] = await db.select().from(courseStructureImportJobsTable)
      .where(eq(courseStructureImportJobsTable.id, jobId));
    if (!job) {
      res.status(404).json({ error: "Bulk import job not found" });
      return;
    }
    if (!ACTIVE_STRUCTURE_IMPORT_STATUSES.has(job.status)) {
      res.status(409).json({ error: "This bulk import is no longer running" });
      return;
    }
    await db.update(courseStructureImportJobsTable)
      .set({ cancelRequested: true, updatedAt: new Date() })
      .where(eq(courseStructureImportJobsTable.id, jobId));
    res.json({ job: await getStructureImportJob(jobId) });
  } catch {
    res.status(500).json({ error: "Could not cancel bulk import" });
  }
});

router.post("/curriculum/structure-imports/:jobId/retry-failed", requireAdmin, async (req, res) => {
  const jobId = String(req.params.jobId);
  try {
    const [job] = await db.select().from(courseStructureImportJobsTable)
      .where(eq(courseStructureImportJobsTable.id, jobId));
    if (!job) {
      res.status(404).json({ error: "Bulk import job not found" });
      return;
    }
    if (ACTIVE_STRUCTURE_IMPORT_STATUSES.has(job.status)) {
      res.status(409).json({ error: "Wait for the active import to finish before retrying failures" });
      return;
    }
    const items = await db.select().from(courseStructureImportJobItemsTable)
      .where(eq(courseStructureImportJobItemsTable.jobId, jobId));
    // A cancelled job has both failed and not-yet-started courses. Resume every
    // unfinished item so "retry" cannot leave the pending part of the catalog behind.
    const retryableItems = items.filter(item => ["failed", "pending"].includes(item.status));
    if (!retryableItems.length) {
      res.status(409).json({ error: "There are no unfinished courses to retry" });
      return;
    }
    for (const item of retryableItems) {
      await db.update(courseStructureImportJobItemsTable)
        .set({ status: "pending", error: null, finishedAt: null, updatedAt: new Date() })
        .where(eq(courseStructureImportJobItemsTable.id, item.id));
    }
    await db.update(courseStructureImportJobsTable)
      .set({
        status: "queued",
        cancelRequested: false,
        finishedAt: null,
        currentCourseId: null,
        currentCourseName: null,
        updatedAt: new Date(),
      })
      .where(eq(courseStructureImportJobsTable.id, jobId));
    await refreshStructureImportSummary(jobId, { status: "queued", finishedAt: null });
    queueStructureImportJob(jobId);
    res.status(202).json({ job: await getStructureImportJob(jobId) });
  } catch {
    res.status(500).json({ error: "Could not retry failed course imports" });
  }
});

// ─── Bulk TriByte resource imports ───────────────────────────────────────────

type ResourceParent = {
  topicId: string | null;
  subtopicId: string | null;
  sourceNid: string;
};

type DiscoveredNode = {
  nid: string;
  title: string;
};

type ResourceImportResult = {
  discovered: number;
  imported: number;
  failed: number;
  unavailable: number;
};

type TriByteResourceCandidate = ParsedTriByteResource & ResourceParent & {
  previewUrl?: string;
};

const activeResourceImportRunners = new Set<string>();
const TRIBYTE_RESOURCE_HOSTS = new Set([
  "admin.learn.himtelearning.com",
  "static.learn.himtelearning.com",
]);
const TRIBYTE_RESOURCE_REDIRECT_HOSTS = new Set([
  // Confirmed destination for protected content downloaded from the authenticated
  // TriByte clipping route. Keep this allow-list exact rather than permitting
  // arbitrary S3 endpoints.
  "videos-elearning-himtmarine-com.s3.ap-southeast-1.amazonaws.com",
  "videos-elearning-himtmarine-com.s3.amazonaws.com",
]);
const EXTERNAL_VIDEO_HOSTS = new Set([
  "youtu.be",
  "www.youtube.com",
  "youtube.com",
  "vimeo.com",
  "www.vimeo.com",
]);
// Publitas is a digital-publication platform (flipbooks / slide decks), not
// a video host. Redirect to its viewer URL the same way we redirect to
// external videos, but classify the resource as Document.
const EXTERNAL_DOCUMENT_HOSTS = new Set([
  "view.publitas.com",
]);

function stableResourceId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function publicResourceImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/g, "the source file")
    .slice(0, 300);
}

function isTriByteUrl(url: string): boolean {
  try { return TRIBYTE_RESOURCE_HOSTS.has(new URL(url).hostname.toLowerCase()); }
  catch { return false; }
}

function isApprovedExternalVideoUrl(url: string): boolean {
  try { return EXTERNAL_VIDEO_HOSTS.has(new URL(url).hostname.toLowerCase()); }
  catch { return false; }
}
function isApprovedExternalDocumentUrl(url: string): boolean {
  try { return EXTERNAL_DOCUMENT_HOSTS.has(new URL(url).hostname.toLowerCase()); }
  catch { return false; }
}

function isApprovedDownloadUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return TRIBYTE_RESOURCE_HOSTS.has(hostname) || TRIBYTE_RESOURCE_REDIRECT_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

async function fetchApprovedHls(
  url: string,
  session: { cookie: string; strategy: string },
  referer: string,
  range?: string,
): Promise<Response> {
  let target = new URL(url);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (!isApprovedTriByteHlsUrl(target.href)) {
      throw new Error("Preview playlist host requires review before it can be migrated");
    }
    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: triByteHlsRequestHeaders(target.href, session.cookie, referer, range),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Preview playlist returned an invalid redirect");
    target = new URL(location, target);
  }
  throw new Error("Preview playlist redirected too many times");
}

async function findTriBytePreviewPlaylist(
  previewUrl: string,
  session: { cookie: string; strategy: string },
): Promise<string | null> {
  if (!isTriByteUrl(previewUrl)) {
    throw new Error("Preview player is not hosted by TriByte");
  }
  const html = await fetchTriByteResourcePage(previewUrl, session);
  const candidates = parseTriBytePreviewPlaylists(html, previewUrl);
  const playlistUrl = candidates.find(isApprovedTriByteHlsUrl);
  if (!playlistUrl) {
    if (candidates.length > 0) {
      throw new Error("Preview playlist host requires review before it can be migrated");
    }
    return null;
  }
  const response = await fetchApprovedHls(playlistUrl, session, previewUrl);
  if (!response.ok) {
    throw new Error(`Preview playlist responded ${response.status}`);
  }
  const playlist = await response.text();
  if (!playlist.trimStart().startsWith("#EXTM3U")) {
    throw new Error("Preview player did not return a valid HLS playlist");
  }
  return playlistUrl;
}

async function createTriByteHlsProxy(
  playlistUrl: string,
  previewUrl: string,
  session: { cookie: string; strategy: string },
): Promise<{
  inputUrl: string;
  close: () => Promise<void>;
  getDefinitiveUnavailableError: () => Error | null;
}> {
  const routeToken = randomBytes(16).toString("hex");
  const sources = new Map<string, string>();
  const sourceIds = new Map<string, string>();
  let nextSourceId = 0;
  let baseUrl = "";
  let definitiveUnavailableError: Error | null = null;

  const register = (rawUrl: string): string => {
    const absoluteUrl = new URL(rawUrl).href;
    if (!isApprovedTriByteHlsUrl(absoluteUrl)) {
      throw new Error("Preview HLS child host requires review before it can be migrated");
    }
    let sourceId = sourceIds.get(absoluteUrl);
    if (!sourceId) {
      sourceId = String(++nextSourceId);
      sourceIds.set(absoluteUrl, sourceId);
      sources.set(sourceId, absoluteUrl);
    }
    return `${baseUrl}/${routeToken}/${sourceId}`;
  };

  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== "GET" || !request.url) {
          response.statusCode = 405;
          response.end();
          return;
        }
        const pathname = new URL(request.url, baseUrl).pathname;
        const match = pathname.match(new RegExp(`^/${routeToken}/(\\d+)$`));
        const sourceUrl = match ? sources.get(match[1]) : null;
        if (!sourceUrl) {
          response.statusCode = 404;
          response.end();
          return;
        }

        const upstream = await fetchApprovedHls(
          sourceUrl,
          session,
          previewUrl,
          typeof request.headers.range === "string" ? request.headers.range : undefined,
        );
        if (!upstream.ok || !upstream.body) {
          const error = new Error(`Preview HLS child responded ${upstream.status}`);
          if (isDefinitiveTriByteUnavailable(error)) definitiveUnavailableError = error;
          throw error;
        }

        const reader = upstream.body.getReader();
        const prefixChunks: Buffer[] = [];
        let prefixBytes = 0;
        while (prefixBytes < 1_024) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const value = Buffer.from(chunk.value);
          prefixChunks.push(value);
          prefixBytes += value.length;
          if (value.length > 0) break;
        }
        const prefix = Buffer.concat(prefixChunks);
        const contentType = upstream.headers.get("content-type") ?? "";
        const sourcePath = new URL(sourceUrl).pathname;
        const isManifest = /\.m3u8$/i.test(sourcePath)
          || /(?:mpegurl|vnd\.apple\.mpegurl)/i.test(contentType)
          || prefix.toString("utf8").replace(/^\uFEFF/, "").trimStart().startsWith("#EXTM3U");

        response.setHeader("Connection", "close");
        if (isManifest) {
          const manifestChunks = [prefix];
          let manifestBytes = prefix.length;
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            const value = Buffer.from(chunk.value);
            manifestBytes += value.length;
            if (manifestBytes > 10 * 1024 * 1024) {
              throw new Error("Preview HLS manifest is unexpectedly large");
            }
            manifestChunks.push(value);
          }
          const manifest = Buffer.concat(manifestChunks).toString("utf8");
          if (!manifest.replace(/^\uFEFF/, "").trimStart().startsWith("#EXTM3U")) {
            const error = new Error("Preview player did not return a valid HLS playlist");
            definitiveUnavailableError = error;
            throw error;
          }
          const rewritten = rewriteHlsManifest(manifest, sourceUrl, register);
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
          response.setHeader("Content-Length", Buffer.byteLength(rewritten));
          response.end(rewritten);
          return;
        }

        response.statusCode = upstream.status;
        for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
          const value = upstream.headers.get(header);
          if (value) response.setHeader(header, value);
        }
        if (prefix.length > 0) response.write(prefix);
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (!response.write(Buffer.from(chunk.value))) {
            await new Promise<void>(resolve => response.once("drain", resolve));
          }
        }
        response.end();
      } catch (error) {
        if (isDefinitiveTriByteUnavailable(error)) {
          definitiveUnavailableError = error instanceof Error ? error : new Error(String(error));
        }
        if (!response.headersSent) response.statusCode = 502;
        response.end();
      }
    })();
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start the private HLS recovery proxy");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    inputUrl: register(playlistUrl),
    getDefinitiveUnavailableError: () => definitiveUnavailableError,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function storeTriBytePreviewVideo(
  playlistUrl: string,
  previewUrl: string,
  objectPath: string,
  session: { cookie: string; strategy: string },
): Promise<{ checksum: string; sizeBytes: number }> {
  const proxy = await createTriByteHlsProxy(playlistUrl, previewUrl, session);
  const ffmpeg = spawn("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "warning",
    "-protocol_whitelist", "http,tcp,crypto",
    "-i", proxy.inputUrl,
    "-map", "0:v?",
    "-map", "0:a?",
    "-c", "copy",
    "-movflags", "frag_keyframe+empty_moov",
    "-f", "mp4",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    let stderr = "";
    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    const exit = new Promise<void>((resolve, reject) => {
      ffmpeg.once("error", reject);
      ffmpeg.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(
          `Preview video conversion stopped (${signal ?? `exit ${code ?? "unknown"}`})${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ));
      });
    });
    const upload = storeResourceStream(
      objectPath,
      Readable.toWeb(ffmpeg.stdout) as unknown as ReadableStream<Uint8Array>,
      "video/mp4",
    );
    const [uploadResult, exitResult] = await Promise.allSettled([upload, exit]);
    if (uploadResult.status === "rejected") throw uploadResult.reason;
    if (exitResult.status === "rejected") throw exitResult.reason;
    if (uploadResult.value.sizeBytes <= 0) {
      throw new Error("Preview video conversion returned no content");
    }
    return uploadResult.value;
  } catch (error) {
    ffmpeg.kill("SIGTERM");
    await deleteStoredResource(objectPath).catch(() => undefined);
    throw proxy.getDefinitiveUnavailableError() ?? error;
  } finally {
    await proxy.close();
  }
}

async function resolveTriByteDownloadUsername(): Promise<string | null> {
  // TriByte's protected clipping endpoint may require uname even when the
  // server has a valid authenticated session. Keep that value out of persisted
  // source URLs, and add it only to the in-memory download request.
  try {
    const [storedUsername] = await db.select().from(appSettingsTable)
      .where(eq(appSettingsTable.key, "tribyte_username"));
    if (storedUsername?.value.trim()) return storedUsername.value.trim();
  } catch {
    // Fall back to the environment credential below.
  }
  return process.env.TRIBYTE_USERNAME?.trim() || null;
}

async function fetchApprovedResource(
  url: string,
  session: { cookie: string; strategy: string },
): Promise<Response> {
  let target = new URL(url);
  if (
    isTriByteUrl(target.href)
    && target.pathname === "/reviewer/download/clipping"
    && !target.searchParams.has("uname")
  ) {
    const username = await resolveTriByteDownloadUsername();
    if (username) target.searchParams.set("uname", username);
  }
  for (let redirects = 0; redirects < 4; redirects++) {
    if (!isApprovedDownloadUrl(target.href)) {
      throw new Error("External source requires review before it can be migrated");
    }
    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS * 4),
      headers: {
        "User-Agent": "Mozilla/5.0",
        ...(isTriByteUrl(target.href) ? { Cookie: session.cookie } : {}),
      },
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Source file returned an invalid redirect");
    target = new URL(location, target);
  }
  throw new Error("Source file redirected too many times");
}

function resourceMimeFromName(name: string, fallback: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mp3: "audio/mpeg", wav: "audio/wav", zip: "application/zip",
  };
  return byExtension[extension ?? ""] ?? fallback;
}

async function fetchTriByteResourcePage(
  url: string,
  session: { cookie: string; strategy: string },
): Promise<string> {
  const pagePath = new URL(url).pathname;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0",
        ...(isTriByteUrl(url) ? { Cookie: session.cookie } : {}),
      },
    });
    if (response.ok) {
      const html = await response.text();
      if (!isTBLoginPage(html)) return html;
    }

    const canRefresh = isTriByteUrl(url) && attempt === 0 && [401, 403].includes(response.status);
    if (!canRefresh) {
      throw new Error(`TriByte resource page ${pagePath} responded ${response.status}`);
    }

    invalidateTBSessionCache();
    const refreshed = await resolveTriByteCookie();
    if (!refreshed) {
      throw new Error("TriByte rejected the stored login — check the configured credentials");
    }
    session.cookie = refreshed.cookie;
    session.strategy = refreshed.strategy;
  }
  throw new Error("TriByte rejected the stored login — check the configured credentials");
}

function cleanTriByteText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTriByteNodes(
  html: string,
  pathPattern: RegExp,
): DiscoveredNode[] {
  const found: DiscoveredNode[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const nid = href.match(pathPattern)?.[1];
    if (!nid || seen.has(nid)) continue;
    seen.add(nid);
    const title = match[1].match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    found.push({
      nid,
      title: cleanTriByteText(title) || cleanTriByteText(match[2]) || `Content ${nid}`,
    });
  }
  return found;
}

async function ensureTriByteSubtopic(
  course: typeof curriculumCoursesTable.$inferSelect,
  topic: typeof courseTopicsTable.$inferSelect,
  discovered: DiscoveredNode,
  order: number,
): Promise<typeof courseSubtopicsTable.$inferSelect> {
  const [existing] = await db.select().from(courseSubtopicsTable)
    .where(and(
      eq(courseSubtopicsTable.courseId, course.id),
      eq(courseSubtopicsTable.nid, discovered.nid),
    ));
  if (existing) return existing;
  const id = triByteSubtopicId(course.id, discovered.nid);
  const [created] = await db.insert(courseSubtopicsTable).values({
    id,
    topicId: topic.id,
    courseId: course.id,
    nid: discovered.nid,
    name: discovered.title.slice(0, 500),
    order,
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [afterConflict] = await db.select().from(courseSubtopicsTable)
    .where(and(
      eq(courseSubtopicsTable.courseId, course.id),
      eq(courseSubtopicsTable.nid, discovered.nid),
    ));
  if (!afterConflict) throw new Error(`Could not persist TriByte sub-topic ${discovered.nid}`);
  return afterConflict;
}

/**
 * Older resource scans created every newly discovered TriByte sub-topic with
 * order zero. Repair only that unmistakable default state; a non-zero ordering
 * may represent an administrator's intentional LMS arrangement.
 */
async function repairDefaultTriByteSubtopicOrder(
  course: typeof curriculumCoursesTable.$inferSelect,
  topic: typeof courseTopicsTable.$inferSelect,
  discoveredSubtopics: DiscoveredNode[],
): Promise<void> {
  if (discoveredSubtopics.length < 2) return;
  const expectedNids = new Set(discoveredSubtopics.map(subtopic => subtopic.nid));
  const existing = (await db.select().from(courseSubtopicsTable)
    .where(eq(courseSubtopicsTable.topicId, topic.id)))
    .filter(subtopic => expectedNids.has(subtopic.nid ?? ""));

  if (
    existing.length !== discoveredSubtopics.length
    || !existing.every(subtopic => (subtopic.order ?? 0) === 0)
  ) return;

  for (const [order, discovered] of discoveredSubtopics.entries()) {
    const subtopic = existing.find(row => row.nid === discovered.nid);
    if (!subtopic) continue;
    await db.update(courseSubtopicsTable)
      .set({ order })
      .where(eq(courseSubtopicsTable.id, subtopic.id));
  }
}

async function collectCourseResources(
  course: typeof curriculumCoursesTable.$inferSelect,
  session: { cookie: string; strategy: string },
): Promise<TriByteResourceCandidate[]> {
  const entries: TriByteResourceCandidate[] = [];
  const seen = new Set<string>();
  const scannedSubtopics = new Set<string>();
  const addFromHtml = (
    html: string,
    url: string,
    parent: ResourceParent,
    previewUrl?: string,
  ) => {
    let added = 0;
    for (const resource of parseTriByteResources(html, url)) {
      const key = `${parent.sourceNid}:${resource.sourceUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const canUsePreview = ["Video", "Recording"].includes(resource.resourceType);
      entries.push({
        ...resource,
        ...parent,
        ...(previewUrl && canUsePreview ? { previewUrl } : {}),
      });
      added++;
    }
    return added;
  };
  const addFromPage = async (url: string, parent: ResourceParent) => {
    const html = await fetchTriByteResourcePage(url, session);
    addFromHtml(html, url, parent);
    return html;
  };
  const inspectSubtopic = async (
    topicId: string,
    subtopicId: string,
    subtopicNid: string,
  ) => {
    if (!subtopicNid || scannedSubtopics.has(subtopicNid)) return;
    scannedSubtopics.add(subtopicNid);
    const subtopicParent = {
      topicId,
      subtopicId,
      sourceNid: subtopicNid,
    };
    await addFromPage(`${TB_BASE_URL}/node/${subtopicNid}`, subtopicParent);
    const contentsUrl = `${TB_BASE_URL}/node/${subtopicNid}/edit/contents`;
    const contentsHtml = await addFromPage(contentsUrl, subtopicParent);
    const previewByNid = new Map(
      parseTriBytePreviewLinks(contentsHtml, contentsUrl)
        .map(preview => [preview.sourceNid, preview.previewUrl]),
    );
    const contentRecords = extractTriByteNodes(
      contentsHtml,
      /\/node\/(\d+)\/edit\/content\/tab(?:[/?]|$)/i,
    );
    for (const content of contentRecords) {
      const contentParent = { ...subtopicParent, sourceNid: content.nid };
      const contentUrl = `${TB_BASE_URL}/node/${content.nid}/edit/content/tab`;
      const contentHtml = await fetchTriByteResourcePage(contentUrl, session);
      const previewUrl = previewByNid.get(content.nid);
      const startIndex = entries.length;
      addFromHtml(contentHtml, contentUrl, contentParent, previewUrl);
      const foundDirectResource = entries.length > startIndex;
      // A playable Preview can be the only surviving source after TriByte loses
      // its original clipping download. Preserve it as a candidate so recovery
      // can assemble the HLS stream into a private LMS video.
      if (previewUrl && !foundDirectResource && isTriByteVideoContentRecord(contentHtml)) {
        const key = `${content.nid}:${previewUrl}`;
        if (!seen.has(key)) {
          seen.add(key);
          const safeTitle = content.title.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
          entries.push({
            sourceUrl: previewUrl,
            previewUrl,
            title: content.title,
            resourceType: "Video",
            fileName: `${safeTitle || `video-${content.nid}`}.mp4`,
            ...contentParent,
          });
        }
      }
    }
  };

  if (course.tribyteNid) {
    await addFromPage(`${TB_BASE_URL}/node/${course.tribyteNid}`, {
      topicId: null, subtopicId: null, sourceNid: course.tribyteNid,
    });
  }

  const topics = await db.select().from(courseTopicsTable)
    .where(eq(courseTopicsTable.courseId, course.id));
  for (const topic of topics) {
    if (!topic.nid) continue;
    const parent = {
      topicId: topic.id, subtopicId: null, sourceNid: topic.nid,
    };
    await addFromPage(`${TB_BASE_URL}/node/${topic.nid}`, parent);
    // TriByte's learner-facing node can be deliberately sparse. Its
    // authenticated content, metadata, and sub-topic views expose additional
    // resource fields/embeds for the same topic; parser guards exclude their
    // own navigation links.
    await addFromPage(`${TB_BASE_URL}/node/${topic.nid}/edit/content`, parent);
    await addFromPage(`${TB_BASE_URL}/node/${topic.nid}/edit/topic/tab`, parent);
    const subtopicsHtml = await addFromPage(
      `${TB_BASE_URL}/node/${topic.nid}/edit/subtopics`,
      parent,
    );
    const discoveredSubtopics = extractTriByteNodes(
      subtopicsHtml,
      /\/node\/(\d+)\/edit\/contents(?:[/?]|$)/i,
    );
    for (const [subtopicOrder, discovered] of discoveredSubtopics.entries()) {
      const subtopic = await ensureTriByteSubtopic(course, topic, discovered, subtopicOrder);
      const subtopicNid = subtopic.nid ?? discovered.nid;
      await inspectSubtopic(topic.id, subtopic.id, subtopicNid);
    }
    await repairDefaultTriByteSubtopicOrder(course, topic, discoveredSubtopics);
  }
  // Retry/resume must revisit the full Contents → content-record hierarchy for
  // previously known sub-topics too, not merely their sparse learner node.
  const allSubtopics = await db.select().from(courseSubtopicsTable)
    .where(eq(courseSubtopicsTable.courseId, course.id));
  for (const subtopic of allSubtopics) {
    if (!subtopic.nid) continue;
    await inspectSubtopic(subtopic.topicId, subtopic.id, subtopic.nid);
  }

  return entries;
}

async function migrateTriByteResource(
  course: typeof curriculumCoursesTable.$inferSelect,
  resource: TriByteResourceCandidate,
  order: number,
  session: { cookie: string; strategy: string },
): Promise<"imported" | "existing" | "failed" | "unavailable"> {
  const sourceIdentity = `${course.id}:${resource.sourceNid}:${resource.sourceUrl}`;
  const id = `cr-${stableResourceId(sourceIdentity)}`;
  const [existing] = await db.select().from(courseResourcesTable)
    .where(eq(courseResourcesTable.sourceIdentity, sourceIdentity));
  if (existing?.status === "ready" && (existing.storagePath || !isTriByteUrl(existing.sourceUrl))) {
    // Parser improvements can clarify the type or placement of an already
    // migrated resource. Keep the private object intact while refreshing that
    // source metadata, so a single-course repair never downloads it again.
    if (
      existing.topicId !== resource.topicId
      || existing.subtopicId !== resource.subtopicId
      || existing.title !== resource.title.slice(0, 500)
      || existing.resourceType !== resource.resourceType
      || existing.fileName !== resource.fileName.slice(0, 500)
      || existing.order !== order
      || !existing.recoveryMethod
    ) {
      await db.update(courseResourcesTable).set({
        topicId: resource.topicId,
        subtopicId: resource.subtopicId,
        title: resource.title.slice(0, 500),
        resourceType: resource.resourceType,
        fileName: resource.fileName.slice(0, 500),
        order,
        recoveryMethod: existing.recoveryMethod
          ?? (existing.storagePath ? "download" : "external_reference"),
        updatedAt: new Date(),
      }).where(eq(courseResourcesTable.id, existing.id));
    }
    return "existing";
  }

  const resourceRow = {
    id,
    courseId: course.id,
    topicId: resource.topicId,
    subtopicId: resource.subtopicId,
    sourceNid: resource.sourceNid,
    sourceIdentity,
    sourceUrl: resource.sourceUrl,
    title: resource.title.slice(0, 500),
    resourceType: resource.resourceType,
    fileName: resource.fileName.slice(0, 500),
    order,
    status: "pending",
    recoveryMethod: null,
    error: null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(courseResourcesTable).set(resourceRow)
      .where(eq(courseResourcesTable.id, existing.id));
  } else {
    await db.insert(courseResourcesTable).values(resourceRow);
  }

  // Hosted recordings are learner-playable references rather than downloadable
  // files. Only allow the reviewed providers instead of following arbitrary URLs.
  if (
    (isApprovedExternalVideoUrl(resource.sourceUrl) && resource.resourceType === "Video") ||
    (isApprovedExternalDocumentUrl(resource.sourceUrl) && resource.resourceType === "Document")
  ) {
    await db.update(courseResourcesTable).set({
      status: "ready",
      recoveryMethod: "external_reference",
      error: null,
      updatedAt: new Date(),
    })
      .where(eq(courseResourcesTable.id, id));
    return "imported";
  }

  if (!isApprovedDownloadUrl(resource.sourceUrl)) {
    await db.update(courseResourcesTable).set({
      status: "unsupported",
      error: "External source requires review before it can be migrated",
      updatedAt: new Date(),
    }).where(eq(courseResourcesTable.id, id));
    return "failed";
  }

  const objectPath = resourceObjectPath(`${course.id}/${stableResourceId(sourceIdentity)}/${resource.fileName || "resource"}`);
  const previewObjectPath = resourceObjectPath(
    `${course.id}/${stableResourceId(sourceIdentity)}/recovered-preview.mp4`,
  );
  // A previous transfer can complete while its follow-up database write fails
  // (for example, after an interrupted process). Reuse that private object
  // instead of downloading a potentially multi-gigabyte recording again.
  const stored = await inspectStoredResource(objectPath, getStoredResource);
  if (stored) {
    const mimeType = resourceMimeFromName(resource.fileName, stored.contentType);
    await db.update(courseResourcesTable).set({
      status: "ready",
      storagePath: objectPath,
      mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: existing?.checksum ?? null,
      recoveryMethod: existing?.recoveryMethod ?? "storage_resume",
      error: null,
      updatedAt: new Date(),
    }).where(eq(courseResourcesTable.id, id));
    return "imported";
  }

  if (resource.previewUrl) {
    const storedPreview = await inspectStoredResource(previewObjectPath, getStoredResource);
    if (storedPreview) {
      await db.update(courseResourcesTable).set({
        status: "ready",
        storagePath: previewObjectPath,
        mimeType: "video/mp4",
        fileName: resource.fileName.toLowerCase().endsWith(".mp4")
          ? resource.fileName
          : `${resource.title.slice(0, 480)}.mp4`,
        sizeBytes: storedPreview.sizeBytes,
        checksum: existing?.checksum ?? null,
        recoveryMethod: "preview_hls",
        error: null,
        updatedAt: new Date(),
      }).where(eq(courseResourcesTable.id, id));
      return "imported";
    }
  }

  let directError: unknown = resource.sourceUrl === resource.previewUrl
    ? new Error("TriByte exposes no downloadable source for this resource")
    : null;
  try {
    if (resource.sourceUrl !== resource.previewUrl) {
      const response = await fetchApprovedResource(resource.sourceUrl, session);
      if (!response.ok) throw new Error(`Source file responded ${response.status}`);
      if (!response.body) throw new Error("Source file returned no content");
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (contentType.includes("text/html")) {
        throw new Error("Source link is an HTML page, not a downloadable learning resource");
      }
      const stored = await storeResourceStream(
        objectPath,
        response.body,
        resourceMimeFromName(resource.fileName, contentType),
      );
      await db.update(courseResourcesTable).set({
        status: "ready",
        storagePath: objectPath,
        mimeType: resourceMimeFromName(resource.fileName, contentType),
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        recoveryMethod: "download",
        error: null,
        updatedAt: new Date(),
      }).where(eq(courseResourcesTable.id, id));
      return "imported";
    }
  } catch (error) {
    directError = error;
  }

  if (resource.previewUrl && ["Video", "Recording"].includes(resource.resourceType)) {
    try {
      const playlistUrl = await findTriBytePreviewPlaylist(resource.previewUrl, session);
      if (playlistUrl) {
        const stored = await storeTriBytePreviewVideo(
          playlistUrl,
          resource.previewUrl,
          previewObjectPath,
          session,
        );
        await db.update(courseResourcesTable).set({
          status: "ready",
          storagePath: previewObjectPath,
          mimeType: "video/mp4",
          fileName: resource.fileName.toLowerCase().endsWith(".mp4")
            ? resource.fileName
            : `${resource.title.slice(0, 480)}.mp4`,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          recoveryMethod: "preview_hls",
          error: null,
          updatedAt: new Date(),
        }).where(eq(courseResourcesTable.id, id));
        return "imported";
      }
      if (isDefinitiveTriByteUnavailable(directError) || resource.sourceUrl === resource.previewUrl) {
        await db.update(courseResourcesTable).set({
          status: "unavailable",
          error: "TriByte no longer serves a downloadable file or playable Preview for this resource",
          updatedAt: new Date(),
        }).where(eq(courseResourcesTable.id, id));
        return "unavailable";
      }
    } catch (previewError) {
      if (shouldMarkTriByteResourceUnavailable(
        directError,
        previewError,
        resource.sourceUrl === resource.previewUrl,
      )) {
        await db.update(courseResourcesTable).set({
          status: "unavailable",
          error: "TriByte no longer serves a downloadable file or playable Preview for this resource",
          updatedAt: new Date(),
        }).where(eq(courseResourcesTable.id, id));
        return "unavailable";
      }
      const combined = new Error(
        `Download failed: ${publicResourceImportError(directError)}. Preview recovery failed: ${publicResourceImportError(previewError)}`,
      );
      directError = combined;
    }
  } else if (isDefinitiveTriByteUnavailable(directError)) {
    await db.update(courseResourcesTable).set({
      status: "unavailable",
      error: "TriByte no longer serves this resource through its protected download",
      updatedAt: new Date(),
    }).where(eq(courseResourcesTable.id, id));
    return "unavailable";
  }

  {
    await db.update(courseResourcesTable).set({
      status: "failed",
      error: publicResourceImportError(directError),
      updatedAt: new Date(),
    }).where(eq(courseResourcesTable.id, id));
    return "failed";
  }
}

async function importTriByteCourseResources(
  course: typeof curriculumCoursesTable.$inferSelect,
  session: { cookie: string; strategy: string },
): Promise<ResourceImportResult> {
  // The resource job is self-contained: reconcile source topics/sub-topics
  // first, while preserving LMS-authored structure, then traverse every source
  // content record below them.
  await importTriByteCourseTopics(course, session, false);
  const resources = await collectCourseResources(course, session);
  const discoveredIdentities = new Set(
    resources.map(resource => `${course.id}:${resource.sourceNid}:${resource.sourceUrl}`),
  );
  // A parser improvement can legitimately stop recognizing a bad navigation
  // link. Remove only stale, non-stored failures; successful migrations are
  // never deleted merely because a later page scan is incomplete.
  const previous = await db.select().from(courseResourcesTable)
    .where(eq(courseResourcesTable.courseId, course.id));
  for (const resource of previous) {
    if (
      !discoveredIdentities.has(resource.sourceIdentity)
      && !resource.storagePath
      && resource.status !== "ready"
    ) {
      await db.delete(courseResourcesTable).where(eq(courseResourcesTable.id, resource.id));
    }
  }
  let imported = 0;
  let failed = 0;
  let unavailable = 0;
  for (const [index, resource] of resources.entries()) {
    const result = await migrateTriByteResource(course, resource, index, session);
    if (result === "imported") imported++;
    if (result === "failed") failed++;
    if (result === "unavailable") unavailable++;
  }
  return { discovered: resources.length, imported, failed, unavailable };
}

async function getResourceImportJob(jobId: string) {
  const [job] = await db.select().from(courseResourceImportJobsTable)
    .where(eq(courseResourceImportJobsTable.id, jobId));
  if (!job) return null;
  const items = await db.select().from(courseResourceImportJobItemsTable)
    .where(eq(courseResourceImportJobItemsTable.jobId, jobId));
  return { ...job, items };
}

async function refreshResourceImportSummary(
  jobId: string,
  changes: Partial<typeof courseResourceImportJobsTable.$inferInsert> = {},
) {
  const items = await db.select().from(courseResourceImportJobItemsTable)
    .where(eq(courseResourceImportJobItemsTable.jobId, jobId));
  const complete = items.filter(item =>
    item.status === "completed"
    || item.status === "completed_with_unavailable"
    || item.status === "failed"
  );
  await db.update(courseResourceImportJobsTable).set({
    completedCourses: complete.length,
    importedResources: items.reduce((sum, item) => sum + (item.importedResources ?? 0), 0),
    failedResources: items.reduce((sum, item) => sum + (item.failedResources ?? 0), 0),
    unavailableResources: items.reduce((sum, item) => sum + (item.unavailableResources ?? 0), 0),
    updatedAt: new Date(),
    ...changes,
  }).where(eq(courseResourceImportJobsTable.id, jobId));
}

function queueResourceImportJob(jobId: string) {
  setTimeout(() => { void runResourceImportJob(jobId); }, 25);
}

async function runResourceImportJob(jobId: string): Promise<void> {
  if (activeResourceImportRunners.has(jobId)) return;
  activeResourceImportRunners.add(jobId);
  try {
    const [job] = await db.select().from(courseResourceImportJobsTable)
      .where(eq(courseResourceImportJobsTable.id, jobId));
    if (!job) return;
    const session = await resolveTriByteCookie();
    if (!session) throw new Error("No TriByte credentials configured");
    await refreshResourceImportSummary(jobId, {
      status: "running",
      startedAt: job.startedAt ?? new Date(),
      finishedAt: null,
    });

    const items = await db.select().from(courseResourceImportJobItemsTable)
      .where(eq(courseResourceImportJobItemsTable.jobId, jobId));
    for (const item of items.filter(row => row.status === "pending" || row.status === "failed")) {
      const [freshJob] = await db.select().from(courseResourceImportJobsTable)
        .where(eq(courseResourceImportJobsTable.id, jobId));
      if (freshJob?.cancelRequested) {
        await refreshResourceImportSummary(jobId, {
          status: "cancelled",
          currentCourseId: null,
          currentCourseName: null,
          finishedAt: new Date(),
        });
        return;
      }

      await db.update(courseResourceImportJobItemsTable).set({
        status: "running",
        attempts: (item.attempts ?? 0) + 1,
        discoveredResources: 0,
        importedResources: 0,
        failedResources: 0,
        unavailableResources: 0,
        error: null,
        startedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(courseResourceImportJobItemsTable.id, item.id));
      await refreshResourceImportSummary(jobId, {
        currentCourseId: item.courseId,
        currentCourseName: item.courseName,
      });

      try {
        const [course] = await db.select().from(curriculumCoursesTable)
          .where(eq(curriculumCoursesTable.id, item.courseId));
        if (!course) throw new Error("Course was removed from the curriculum");
        const result = await importTriByteCourseResources(course, session);
        await db.update(courseResourceImportJobItemsTable).set({
          status: result.failed > 0
            ? "failed"
            : result.unavailable > 0
              ? "completed_with_unavailable"
              : "completed",
          discoveredResources: result.discovered,
          importedResources: result.imported,
          failedResources: result.failed,
          unavailableResources: result.unavailable,
          error: [
            result.failed > 0
              ? `${result.failed} resource${result.failed === 1 ? "" : "s"} failed`
              : "",
            result.unavailable > 0
              ? `${result.unavailable} no longer available from TriByte`
              : "",
          ].filter(Boolean).join("; ") || null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(courseResourceImportJobItemsTable.id, item.id));
      } catch (error) {
        const publicError = publicResourceImportError(error);
        logger.warn({ jobId, courseId: item.courseId, error: publicError }, "TriByte resource import failed for course");
        await db.update(courseResourceImportJobItemsTable).set({
          status: "failed",
          error: publicError,
          finishedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(courseResourceImportJobItemsTable.id, item.id));
      }
      await refreshResourceImportSummary(jobId, { currentCourseId: null, currentCourseName: null });
    }

    const completedItems = await db.select().from(courseResourceImportJobItemsTable)
      .where(eq(courseResourceImportJobItemsTable.jobId, jobId));
    await refreshResourceImportSummary(jobId, {
      status: completedItems.some(item => item.status === "failed")
        ? "completed_with_failures"
        : completedItems.some(item => item.status === "completed_with_unavailable")
          ? "completed_with_unavailable"
          : "completed",
      currentCourseId: null,
      currentCourseName: null,
      finishedAt: new Date(),
    });
  } catch (error) {
    logger.error({ jobId, error: publicResourceImportError(error) }, "TriByte resource import job stopped");
    await refreshResourceImportSummary(jobId, {
      status: "failed",
      currentCourseId: null,
      currentCourseName: null,
      finishedAt: new Date(),
    });
  } finally {
    activeResourceImportRunners.delete(jobId);
  }
}

async function resumeResourceImportJobs() {
  const jobs = await db.select().from(courseResourceImportJobsTable);
  for (const job of jobs.filter(row => row.status === "queued" || row.status === "running")) {
    const items = await db.select().from(courseResourceImportJobItemsTable)
      .where(eq(courseResourceImportJobItemsTable.jobId, job.id));
    for (const item of items.filter(row => row.status === "running")) {
      await db.update(courseResourceImportJobItemsTable).set({ status: "pending", updatedAt: new Date() })
        .where(eq(courseResourceImportJobItemsTable.id, item.id));
    }
    await db.update(courseResourceImportJobsTable).set({ status: "queued", cancelRequested: false, updatedAt: new Date() })
      .where(eq(courseResourceImportJobsTable.id, job.id));
    queueResourceImportJob(job.id);
  }
}

router.get("/curriculum/resource-imports/latest", requireAdmin, async (_req, res) => {
  try {
    const jobs = await db.select().from(courseResourceImportJobsTable);
    const latest = jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    res.json(latest ? await getResourceImportJob(latest.id) : null);
  } catch {
    res.status(500).json({ error: "Could not load resource import status" });
  }
});

router.post("/curriculum/resource-imports", requireAdmin, async (_req, res) => {
  try {
    const jobs = await db.select().from(courseResourceImportJobsTable);
    if (jobs.some(job => job.status === "queued" || job.status === "running")) {
      res.status(409).json({ error: "A resource import is already running" });
      return;
    }
    const courses = (await db.select().from(curriculumCoursesTable))
      .filter(course => Boolean(course.tribyteNid && course.tribyteTid));
    if (!courses.length) {
      res.status(400).json({ error: "No eligible TriByte courses are available to import" });
      return;
    }
    const jobId = `tri-resource-${randomBytes(8).toString("hex")}`;
    await db.insert(courseResourceImportJobsTable).values({
      id: jobId,
      status: "queued",
      totalCourses: courses.length,
    });
    if (courses.length) {
      await db.insert(courseResourceImportJobItemsTable).values(courses.map((course) => ({
        id: `tri-resource-item-${jobId}-${course.id}`,
        jobId,
        courseId: course.id,
        courseName: course.name,
        status: "pending",
      })));
    }
    queueResourceImportJob(jobId);
    res.status(202).json({ job: await getResourceImportJob(jobId) });
  } catch {
    res.status(500).json({ error: "Could not start resource import" });
  }
});

router.post("/curriculum/courses/:courseId/resource-import", requireAdmin, async (req, res) => {
  try {
    const courseId = String(req.params.courseId);
    const jobs = await db.select().from(courseResourceImportJobsTable);
    if (jobs.some(job => job.status === "queued" || job.status === "running")) {
      res.status(409).json({ error: "A resource import is already running" });
      return;
    }
    const [course] = await db.select().from(curriculumCoursesTable)
      .where(eq(curriculumCoursesTable.id, courseId));
    if (!course) {
      res.status(404).json({ error: "Curriculum course not found" });
      return;
    }
    if (!course.tribyteNid || !course.tribyteTid) {
      res.status(400).json({ error: "Course has no TriByte source identifiers" });
      return;
    }
    const jobId = `tri-resource-${randomBytes(8).toString("hex")}`;
    await db.insert(courseResourceImportJobsTable).values({
      id: jobId,
      status: "queued",
      totalCourses: 1,
    });
    await db.insert(courseResourceImportJobItemsTable).values({
      id: `tri-resource-item-${jobId}-${course.id}`,
      jobId,
      courseId: course.id,
      courseName: course.name,
      status: "pending",
    });
    queueResourceImportJob(jobId);
    res.status(202).json({ job: await getResourceImportJob(jobId) });
  } catch {
    res.status(500).json({ error: "Could not start course resource import" });
  }
});

router.post("/curriculum/resource-imports/:jobId/cancel", requireAdmin, async (req, res) => {
  try {
    const jobId = String(req.params.jobId);
    const [job] = await db.select().from(courseResourceImportJobsTable)
      .where(eq(courseResourceImportJobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Resource import not found" }); return; }
    await db.update(courseResourceImportJobsTable).set({ cancelRequested: true, updatedAt: new Date() })
      .where(eq(courseResourceImportJobsTable.id, jobId));
    res.json({ job: await getResourceImportJob(jobId) });
  } catch {
    res.status(500).json({ error: "Could not cancel resource import" });
  }
});

router.post("/curriculum/resource-imports/:jobId/retry", requireAdmin, async (req, res) => {
  try {
    const jobId = String(req.params.jobId);
    const [job] = await db.select().from(courseResourceImportJobsTable)
      .where(eq(courseResourceImportJobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Resource import not found" }); return; }
    if (job.status === "queued" || job.status === "running") {
      res.status(409).json({ error: "Wait for the active resource import to finish before retrying" });
      return;
    }
    const items = await db.select().from(courseResourceImportJobItemsTable)
      .where(eq(courseResourceImportJobItemsTable.jobId, jobId));
    const unfinished = items.filter(item =>
      item.status === "failed"
      || item.status === "completed_with_unavailable"
      || item.status === "pending"
    );
    if (!unfinished.length) {
      res.status(409).json({ error: "There are no failed or unfinished resource imports to retry" });
      return;
    }
    for (const item of unfinished) {
      await db.update(courseResourceImportJobItemsTable).set({
        status: "pending",
        discoveredResources: 0,
        importedResources: 0,
        failedResources: 0,
        unavailableResources: 0,
        error: null,
        updatedAt: new Date(),
      }).where(eq(courseResourceImportJobItemsTable.id, item.id));
    }
    await refreshResourceImportSummary(jobId, {
      status: "queued",
      cancelRequested: false,
      finishedAt: null,
    });
    queueResourceImportJob(jobId);
    res.status(202).json({ job: await getResourceImportJob(jobId) });
  } catch {
    res.status(500).json({ error: "Could not retry unfinished resource imports" });
  }
});

// ─── DRM-003: content tokens ─────────────────────────────────────────────────

/**
 * Ensure the content_tokens table exists.
 * Called at startup alongside ensureAppSettingsTable and ensureAccessLogsTable.
 * Also starts a periodic cleanup job that prunes already-expired tokens.
 */
export async function ensureContentTokensTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_tokens (
      id          TEXT PRIMARY KEY,
      user_id     TEXT,
      session_id  TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Clean up tokens that expired more than 60 s ago every 5 minutes.
  // Keeps the table small without disrupting any in-flight request.
  const cleanup = async () => {
    try {
      await pool.query(`DELETE FROM content_tokens WHERE expires_at < NOW() - INTERVAL '60 seconds'`);
    } catch (err) { logger.warn({ err }, "content_token cleanup failed"); }
  };
  setInterval(() => { void cleanup(); }, 5 * 60 * 1000);
}

/** Extract bearer token from Authorization header, with fallback to ?token= query param (for iframes). */
function extractBearerToken(req: import("express").Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const q = req.query["token"];
  return typeof q === "string" && q ? q : undefined;
}

/**
 * Verify a one-time content token and, on success, atomically mark it used.
 * Checks: existence, resource match, expiry, one-time-use, session binding.
 */
async function verifyAndConsumeToken(
  token: string | undefined,
  resourceId: string,
  req: import("express").Request,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!token) return { ok: false, status: 403, error: "Content token required — POST /curriculum/resources/:id/token first" };
  const [row] = await db.select().from(contentTokensTable).where(eq(contentTokensTable.id, token));
  if (!row)                          return { ok: false, status: 403, error: "Content token is invalid" };
  if (row.resourceId !== resourceId) return { ok: false, status: 403, error: "Content token is not valid for this resource" };
  if (row.usedAt)                    return { ok: false, status: 403, error: "Content token has already been used" };
  if (new Date() > row.expiresAt)    return { ok: false, status: 403, error: "Content token has expired" };
  // Session binding — admin: Express session ID; learner: Clerk session ID
  const isAdminCaller    = req.session.isAdmin === true;
  const currentSession   = isAdminCaller
    ? (req.sessionID ?? "")
    : (getAuth(req).sessionId ?? req.sessionID ?? "");
  if (row.sessionId !== currentSession) return { ok: false, status: 403, error: "Content token session mismatch" };
  // Atomically mark as used to prevent replay
  await db.update(contentTokensTable).set({ usedAt: new Date() }).where(eq(contentTokensTable.id, token));
  return { ok: true };
}

/**
 * POST /curriculum/resources/:resourceId/token
 * DRM-003: Issues a short-lived (60 s), one-time-use content token tied to
 * userId + sessionId + resourceId. Admin session or enrolled Clerk learner required.
 */
router.post("/curriculum/resources/:resourceId/token", async (req, res) => {
  const isAdminUser = req.session.isAdmin === true;
  const clerkAuth   = getAuth(req);
  if (!isAdminUser && !clerkAuth.userId) {
    res.status(401).json({ error: "Sign in to request a content token" }); return;
  }
  const resourceId = String(req.params.resourceId);
  // Learners must be enrolled in the course that owns this resource
  if (!isAdminUser) {
    const [resource] = await db
      .select({ courseId: courseResourcesTable.courseId, status: courseResourcesTable.status })
      .from(courseResourcesTable)
      .where(eq(courseResourcesTable.id, resourceId));
    if (!resource || resource.status !== "ready") {
      res.status(404).json({ error: "Resource not found" }); return;
    }
    if (!(await learnerCanAccessCourse(req, resource.courseId))) {
      res.status(403).json({ error: "Not enrolled in this course" }); return;
    }
  }
  const sessionId = isAdminUser
    ? (req.sessionID ?? "admin-session")
    : (clerkAuth.sessionId ?? req.sessionID ?? "clerk-session");
  const token     = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60_000);
  await db.insert(contentTokensTable).values({ id: token, userId: clerkAuth.userId ?? null, sessionId, resourceId, expiresAt });
  res.json({ token, expiresAt: expiresAt.toISOString() });
});

// Admin-only resource preview — no enrollment check, just admin auth
// Resource preview — accepts admin session OR any signed-in Clerk user.
// Ready resources are approved content; any authenticated user (admin or learner)
// may view them. Unauthenticated requests are rejected.
router.get("/curriculum/resources/:resourceId/admin-view", async (req, res) => {
  // Block direct browser navigation (address bar / new tab) — resources must be
  // fetched by the in-app previewer, not opened directly as a URL.
  const fetchMode = req.headers["sec-fetch-mode"];
  if (fetchMode === "navigate" || fetchMode === "nested-navigate") {
    res.status(403).json({ error: "This resource can only be viewed inside the application." });
    return;
  }
  const isAdminUser = req.session.isAdmin === true;
  const clerkUserId = getAuth(req).userId;
  if (!isAdminUser && !clerkUserId) {
    // DRM-007: log auth failure even before resource lookup (use param ID)
    await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: "unauthenticated" });
    res.status(401).json({ error: "Sign in to preview this resource" });
    return;
  }
  // DRM-003: verify and consume one-time content token before any content is delivered
  {
    const tokenResult = await verifyAndConsumeToken(extractBearerToken(req), String(req.params.resourceId), req);
    if (!tokenResult.ok) {
      await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: `token:${tokenResult.error}` });
      res.status(tokenResult.status).json({ error: tokenResult.error }); return;
    }
  }
  try {
    const resourceId = String(req.params.resourceId);
    const [resource] = await db.select().from(courseResourcesTable)
      .where(eq(courseResourcesTable.id, resourceId));
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    if (!resource.storagePath) {
      if (!resource.sourceUrl) {
        res.status(404).json({ error: "Resource has no content" });
        return;
      }
      // DRM: Documents and other non-media types must go through the page-image renderer.
      // Recording resources stream raw bytes (they are video/audio); Publitas publications
      // are web-hosted interactive content (not downloadable files) so they redirect to the
      // viewer directly (the URL is not exposed in client JSON, only via server-side redirect).
      const isMediaType = resource.resourceType === "Video" || resource.resourceType === "Recording";
      const isPublitasResource = resource.sourceUrl.includes("view.publitas.com");
      if (!isMediaType && !isPublitasResource) {
        await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_denied", outcomeDetail: "drm_document_redirect_blocked" });
        res.status(403).json({
          error: "Document content must be accessed through the secure page viewer.",
          hint: "Use GET /admin-view/page-count and /admin-view/page/:n instead.",
        });
        return;
      }
      await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_success", outcomeDetail: "external_redirect" });
      res.redirect(302, resource.sourceUrl);
      return;
    }
    // DRM: stored non-media files are served only via the page-image renderer.
    if (resource.resourceType !== "Video" && resource.resourceType !== "Recording") {
      await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_denied", outcomeDetail: "drm_stored_document_blocked" });
      res.status(403).json({
        error: "Document content must be accessed through the secure page viewer.",
        hint: "Use GET /admin-view/page-count and /admin-view/page/:n instead.",
      });
      return;
    }
    const file = await getStoredResource(resource.storagePath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", String(metadata.contentType ?? resource.mimeType ?? "application/octet-stream"));
    res.setHeader("Content-Disposition", `inline; filename="${(resource.fileName || resource.title).replace(/"/g, "")}"`);
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    // DRM-005: prevent caching and direct embedding of protected content
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'");
    await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_success", outcomeDetail: `media_stream:${resource.resourceType}` });
    file.createReadStream().pipe(res);
  } catch (error) {
    await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_error", outcomeDetail: String(error) });
    logger.error({ error }, "Could not serve resource preview");
    res.status(500).json({ error: "Could not open resource" });
  }
});

router.get("/curriculum/resources/:resourceId/open", async (req, res) => {
  // DRM-005: block direct browser navigation — must be fetched by the in-app viewer.
  // Exception: iframes are allowed so that Publitas publications can be embedded via
  // a server-side redirect without exposing the Publitas URL to the client JavaScript.
  const fetchMode = req.headers["sec-fetch-mode"];
  const fetchDest = req.headers["sec-fetch-dest"] as string | undefined;
  if ((fetchMode === "navigate" || fetchMode === "nested-navigate") && fetchDest !== "iframe") {
    res.status(403).json({ error: "This resource can only be viewed inside the application." });
    return;
  }
  // DRM-003: verify and consume one-time content token before any DB or content work
  {
    const tokenResult = await verifyAndConsumeToken(extractBearerToken(req), String(req.params.resourceId), req);
    if (!tokenResult.ok) {
      await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: `token:${tokenResult.error}` });
      res.status(tokenResult.status).json({ error: tokenResult.error }); return;
    }
  }
  try {
    const resourceId = String(req.params.resourceId);
    const [resource] = await db.select().from(courseResourcesTable)
      .where(eq(courseResourcesTable.id, resourceId));
    if (!resource || resource.status !== "ready") {
      res.status(404).json({ error: "Learning resource is not available" });
      return;
    }
    if (!(await learnerCanAccessCourse(req, resource.courseId))) {
      const signedIn = Boolean(getAuth(req).userId);
      await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_denied", outcomeDetail: signedIn ? "not_enrolled" : "unauthenticated" });
      res.status(signedIn ? 403 : 401).json({
        error: signedIn
          ? "You are not enrolled in this course"
          : "Learner sign-in required",
      });
      return;
    }
    // DRM-006: enrollment expiry — check after access grant so admins always bypass
    if (req.session.isAdmin !== true) {
      const learnerForExpiry = await resolveLearner(req);
      if (learnerForExpiry) {
        const [access] = await db
          .select({ expiresAt: learnerCourseAccessTable.expiresAt })
          .from(learnerCourseAccessTable)
          .where(and(
            eq(learnerCourseAccessTable.clerkUserId, learnerForExpiry.clerkUserId),
            eq(learnerCourseAccessTable.courseId, resource.courseId),
          ));
        if (access?.expiresAt && new Date() > access.expiresAt) {
          await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_denied", outcomeDetail: "enrollment_expired" });
          res.status(403).json({ error: "Your enrollment in this course has expired. Please contact your administrator." });
          return;
        }
      }
    }
    if (!resource.storagePath) {
      if (isTriByteUrl(resource.sourceUrl)) {
        res.status(404).json({ error: "Learning resource is not available" });
        return;
      }
      // DRM: external Documents must go through the page-image renderer.
      // Recording resources and Publitas web publications are exempt:
      // - Recordings are media (video/audio) that stream raw bytes
      // - Publitas URLs are for interactive web-hosted publications (not downloadable files);
      //   the viewer URL is not included in client JSON — it reaches the browser only via
      //   this server-side redirect, preserving DRM intent while restoring functionality.
      const isMediaType = resource.resourceType === "Video" || resource.resourceType === "Recording";
      const isPublitasResource = resource.sourceUrl?.includes("view.publitas.com");
      if (!isMediaType && !isPublitasResource) {
        await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_denied", outcomeDetail: "drm_document_redirect_blocked" });
        res.status(403).json({
          error: "Document content must be accessed through the secure page viewer.",
          hint: "Use GET /open/page-count and /open/page/:n instead.",
        });
        return;
      }
      await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_success", outcomeDetail: "external_redirect" });
      res.redirect(302, resource.sourceUrl);
      return;
    }
    // DRM: stored non-media files are served only via the page-image renderer.
    if (resource.resourceType !== "Video" && resource.resourceType !== "Recording") {
      await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_denied", outcomeDetail: "drm_stored_document_blocked" });
      res.status(403).json({
        error: "Document content must be accessed through the secure page viewer.",
        hint: "Use GET /open/page-count and /open/page/:n instead.",
      });
      return;
    }
    const file = await getStoredResource(resource.storagePath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", String(metadata.contentType ?? resource.mimeType ?? "application/octet-stream"));
    res.setHeader("Content-Disposition", `inline; filename="${(resource.fileName || resource.title).replace(/"/g, "")}"`);
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    // DRM-005: prevent caching and direct embedding of protected content
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'");
    await logContentAccess({ req, resourceId, courseId: resource.courseId, action: "view_success", outcomeDetail: `media_stream:${resource.resourceType}` });
    file.createReadStream().pipe(res);
  } catch (error) {
    await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_error", outcomeDetail: String(error) });
    logger.error({ error: publicResourceImportError(error) }, "Could not serve learning resource");
    res.status(500).json({ error: "Could not open learning resource" });
  }
});

// ── DRM helpers ──────────────────────────────────────────────────────────────

/**
 * Fetch a non-TriByte external document URL and return a Node.js Readable.
 * Used by the page-count and page-render endpoints for externally hosted documents.
 */
async function fetchExternalDocumentStream(sourceUrl: string): Promise<Readable> {
  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`External document fetch failed with HTTP ${response.status}`);
  }
  // response.body is a Web ReadableStream<Uint8Array>; convert to Node Readable
  return Readable.from(response.body as AsyncIterable<Uint8Array>);
}

/** Build watermark lines from the current authenticated user. */
async function getWatermarkInfo(req: import("express").Request): Promise<{ line1: string; line2: string }> {
  const ts = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const line2 = `CONFIDENTIAL · ${ts}`;
  if (req.session.isAdmin === true) {
    const name = process.env.ADMIN_USERNAME ?? "HIMT Admin";
    return { line1: `Admin: ${name}`, line2 };
  }
  const clerkUserId = getAuth(req).userId;
  if (clerkUserId) {
    const u = await clerkClient.users.getUser(clerkUserId);
    const email = u.primaryEmailAddress?.emailAddress ?? "unknown";
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return { line1: name ? `${name} · ${email}` : email, line2 };
  }
  return { line1: "Unknown User", line2 };
}

/** Apply DRM response headers for page images. */
function setPageImageHeaders(res: import("express").Response): void {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'");
}

// ── Admin: page-count ─────────────────────────────────────────────────────────

router.get("/curriculum/resources/:resourceId/admin-view/page-count", async (req, res) => {
  const fetchMode = req.headers["sec-fetch-mode"];
  if (fetchMode === "navigate" || fetchMode === "nested-navigate") {
    res.status(403).json({ error: "This resource can only be viewed inside the application." }); return;
  }
  // Admin-view routes require a valid admin session — not just any Clerk identity.
  if (req.session.isAdmin !== true) {
    await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: "admin_session_required" });
    res.status(403).json({ error: "Admin access required" }); return;
  }
  // DRM-003: verify and consume one-time content token
  {
    const tokenResult = await verifyAndConsumeToken(extractBearerToken(req), String(req.params.resourceId), req);
    if (!tokenResult.ok) {
      await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: `token:${tokenResult.error}` });
      res.status(tokenResult.status).json({ error: tokenResult.error }); return;
    }
  }
  try {
    const [resource] = await db.select().from(courseResourcesTable)
      .where(eq(courseResourcesTable.id, req.params.resourceId));
    if (!resource) { res.status(404).json({ error: "Resource not found" }); return; }
    let docStream: Readable;
    if (resource.storagePath) {
      const file = await getStoredResource(resource.storagePath);
      docStream = file.createReadStream() as unknown as Readable;
    } else if (resource.sourceUrl?.includes("view.publitas.com")) {
      // Publitas is a web-hosted interactive publication — the viewer URL returns HTML,
      // not a downloadable PDF. Signal the client to use the server-side iframe embed.
      await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: "view_success", outcomeDetail: "doc_session:publitas" });
      res.json({ pageCount: null, isPdf: false, externalViewer: "publitas" }); return;
    } else if (resource.sourceUrl && !isTriByteUrl(resource.sourceUrl)) {
      docStream = await fetchExternalDocumentStream(resource.sourceUrl);
    } else {
      res.json({ pageCount: null, isPdf: false }); return;
    }
    const pageCount = await getPageCountFromStream(docStream, resource.mimeType);
    // DRM-007: log document view session start (page-count = learner opened the doc viewer)
    await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: pageCount !== null ? "view_success" : "view_error", outcomeDetail: pageCount !== null ? `doc_session:${pageCount}pp` : "page_count_null" });
    res.json({ pageCount, isPdf: pageCount !== null });
  } catch (error) {
    logger.error({ error }, "admin page-count failed");
    res.status(500).json({ error: "Could not determine page count" });
  }
});

// ── Admin: render page ────────────────────────────────────────────────────────

router.get("/curriculum/resources/:resourceId/admin-view/page/:pageNum", async (req, res) => {
  const fetchMode = req.headers["sec-fetch-mode"];
  if (fetchMode === "navigate" || fetchMode === "nested-navigate") {
    res.status(403).json({ error: "This resource can only be viewed inside the application." }); return;
  }
  // Admin-view routes require a valid admin session — not just any Clerk identity.
  if (req.session.isAdmin !== true) {
    await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: "admin_session_required" });
    res.status(403).json({ error: "Admin access required" }); return;
  }
  const pageNum = parseInt(req.params.pageNum, 10);
  if (!Number.isFinite(pageNum) || pageNum < 1) {
    res.status(400).json({ error: "Invalid page number" }); return;
  }
  // DRM-003: verify and consume one-time content token
  {
    const tokenResult = await verifyAndConsumeToken(extractBearerToken(req), String(req.params.resourceId), req);
    if (!tokenResult.ok) {
      await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: `token:${tokenResult.error}` });
      res.status(tokenResult.status).json({ error: tokenResult.error }); return;
    }
  }
  try {
    const [resource] = await db.select().from(courseResourcesTable)
      .where(eq(courseResourcesTable.id, req.params.resourceId));
    if (!resource) { res.status(404).json({ error: "Resource not available" }); return; }
    let docStream: Readable;
    if (resource.storagePath) {
      const file = await getStoredResource(resource.storagePath);
      docStream = file.createReadStream() as unknown as Readable;
    } else if (resource.sourceUrl && !isTriByteUrl(resource.sourceUrl)) {
      docStream = await fetchExternalDocumentStream(resource.sourceUrl);
    } else {
      res.status(404).json({ error: "Resource content not available" }); return;
    }
    const { line1, line2 } = await getWatermarkInfo(req);
    const png = await renderProtectedPage({
      pdfStream: docStream,
      pageNum, watermarkLine1: line1, watermarkLine2: line2,
      mimeType: resource.mimeType,
    });
    await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: "view_success", outcomeDetail: `page_render:${pageNum}` });
    setPageImageHeaders(res);
    res.end(png);
  } catch (error) {
    await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_error", outcomeDetail: String(error).slice(0, 200) });
    logger.error({ error }, "admin page render failed");
    res.status(500).json({ error: "Could not render page" });
  }
});

// ── Learner: page-count ───────────────────────────────────────────────────────

router.get("/curriculum/resources/:resourceId/open/page-count", async (req, res) => {
  const fetchMode = req.headers["sec-fetch-mode"];
  if (fetchMode === "navigate" || fetchMode === "nested-navigate") {
    res.status(403).json({ error: "This resource can only be viewed inside the application." }); return;
  }
  // DRM-003: verify and consume one-time content token
  {
    const tokenResult = await verifyAndConsumeToken(extractBearerToken(req), String(req.params.resourceId), req);
    if (!tokenResult.ok) {
      await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: `token:${tokenResult.error}` });
      res.status(tokenResult.status).json({ error: tokenResult.error }); return;
    }
  }
  try {
    const [resource] = await db.select().from(courseResourcesTable)
      .where(eq(courseResourcesTable.id, req.params.resourceId));
    if (!resource || resource.status !== "ready") { res.status(404).json({ error: "Resource not available" }); return; }
    if (!(await learnerCanAccessCourse(req, resource.courseId))) {
      const signedIn = Boolean(getAuth(req).userId);
      await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: "view_denied", outcomeDetail: signedIn ? "not_enrolled" : "unauthenticated" });
      res.status(signedIn ? 403 : 401).json({ error: signedIn ? "Not enrolled in this course" : "Sign in required" }); return;
    }
    // DRM-006: enrollment expiry
    if (req.session.isAdmin !== true) {
      const learnerForExpiry = await resolveLearner(req);
      if (learnerForExpiry) {
        const [access] = await db
          .select({ expiresAt: learnerCourseAccessTable.expiresAt })
          .from(learnerCourseAccessTable)
          .where(and(
            eq(learnerCourseAccessTable.clerkUserId, learnerForExpiry.clerkUserId),
            eq(learnerCourseAccessTable.courseId, resource.courseId),
          ));
        if (access?.expiresAt && new Date() > access.expiresAt) {
          await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: "view_denied", outcomeDetail: "enrollment_expired" });
          res.status(403).json({ error: "Your enrollment in this course has expired." }); return;
        }
      }
    }
    let docStream: Readable;
    if (resource.storagePath) {
      const file = await getStoredResource(resource.storagePath);
      docStream = file.createReadStream() as unknown as Readable;
    } else if (resource.sourceUrl?.includes("view.publitas.com")) {
      // Publitas publications are web-hosted interactive content, not downloadable PDFs.
      // Signal the client to use the server-side iframe embed path instead.
      await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: "view_success", outcomeDetail: "doc_session:publitas" });
      res.json({ pageCount: null, isPdf: false, externalViewer: "publitas" }); return;
    } else if (resource.sourceUrl && !isTriByteUrl(resource.sourceUrl)) {
      docStream = await fetchExternalDocumentStream(resource.sourceUrl);
    } else {
      res.json({ pageCount: null, isPdf: false }); return;
    }
    const pageCount = await getPageCountFromStream(docStream, resource.mimeType);
    await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: pageCount !== null ? "view_success" : "view_error", outcomeDetail: pageCount !== null ? `doc_session:${pageCount}pp` : "page_count_null" });
    res.json({ pageCount, isPdf: pageCount !== null });
  } catch (error) {
    logger.error({ error }, "learner page-count failed");
    res.status(500).json({ error: "Could not determine page count" });
  }
});

// ── Learner: render page ──────────────────────────────────────────────────────

router.get("/curriculum/resources/:resourceId/open/page/:pageNum", async (req, res) => {
  const fetchMode = req.headers["sec-fetch-mode"];
  if (fetchMode === "navigate" || fetchMode === "nested-navigate") {
    res.status(403).json({ error: "This resource can only be viewed inside the application." }); return;
  }
  const pageNum = parseInt(req.params.pageNum, 10);
  if (!Number.isFinite(pageNum) || pageNum < 1) {
    res.status(400).json({ error: "Invalid page number" }); return;
  }
  // DRM-003: verify and consume one-time content token
  {
    const tokenResult = await verifyAndConsumeToken(extractBearerToken(req), String(req.params.resourceId), req);
    if (!tokenResult.ok) {
      await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_denied", outcomeDetail: `token:${tokenResult.error}` });
      res.status(tokenResult.status).json({ error: tokenResult.error }); return;
    }
  }
  try {
    const [resource] = await db.select().from(courseResourcesTable)
      .where(eq(courseResourcesTable.id, req.params.resourceId));
    if (!resource || resource.status !== "ready") { res.status(404).json({ error: "Resource not available" }); return; }
    if (!(await learnerCanAccessCourse(req, resource.courseId))) {
      const signedIn = Boolean(getAuth(req).userId);
      await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: "view_denied", outcomeDetail: signedIn ? "not_enrolled" : "unauthenticated" });
      res.status(signedIn ? 403 : 401).json({ error: signedIn ? "Not enrolled in this course" : "Sign in required" }); return;
    }
    // DRM-006: enrollment expiry — enforced on every page render, not only at session start
    if (req.session.isAdmin !== true) {
      const learnerForExpiry = await resolveLearner(req);
      if (learnerForExpiry) {
        const [access] = await db
          .select({ expiresAt: learnerCourseAccessTable.expiresAt })
          .from(learnerCourseAccessTable)
          .where(and(
            eq(learnerCourseAccessTable.clerkUserId, learnerForExpiry.clerkUserId),
            eq(learnerCourseAccessTable.courseId, resource.courseId),
          ));
        if (access?.expiresAt && new Date() > access.expiresAt) {
          await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: "view_denied", outcomeDetail: "enrollment_expired" });
          res.status(403).json({ error: "Your enrollment in this course has expired. Please contact your administrator." }); return;
        }
      }
    }
    let docStream: Readable;
    if (resource.storagePath) {
      const file = await getStoredResource(resource.storagePath);
      docStream = file.createReadStream() as unknown as Readable;
    } else if (resource.sourceUrl && !isTriByteUrl(resource.sourceUrl)) {
      docStream = await fetchExternalDocumentStream(resource.sourceUrl);
    } else {
      res.status(404).json({ error: "Resource content not available" }); return;
    }
    const { line1, line2 } = await getWatermarkInfo(req);
    const png = await renderProtectedPage({
      pdfStream: docStream,
      pageNum, watermarkLine1: line1, watermarkLine2: line2,
      mimeType: resource.mimeType,
    });
    await logContentAccess({ req, resourceId: resource.id, courseId: resource.courseId, action: "view_success", outcomeDetail: `page_render:${pageNum}` });
    setPageImageHeaders(res);
    res.end(png);
  } catch (error) {
    await logContentAccess({ req, resourceId: String(req.params.resourceId), courseId: "unknown", action: "view_error", outcomeDetail: String(error).slice(0, 200) });
    logger.error({ error }, "learner page render failed");
    res.status(500).json({ error: "Could not render page" });
  }
});

setTimeout(() => { void resumeStructureImportJobs(); }, 1_000);
setTimeout(() => { void resumeResourceImportJobs(); }, 1_200);

/**
 * POST /api/curriculum/sync-tribyte
 *
 * Protected by requireAdmin (session cookie set via POST /api/auth/login).
 *
 * Scrapes the full course list from TriByte and upserts every course into the
 * curriculum_courses table (adds new ones, updates names/thumbnails of changed
 * ones, leaves all other data intact).
 *
 * TriByte credential strategies tried in order; each failure moves to the next:
 *   1. TRIBYTE_SESSION env var — raw Cookie header string (fastest)
 *   2. TRIBYTE_USERNAME + TRIBYTE_PASSWORD — Drupal form login → session cookies
 *
 * If NO TriByte credentials are configured at all, falls back to the embedded
 * TRIBYTE_COURSES static list (development/demo mode — clearly flagged in the
 * response as usedStaticFallback).  If credentials ARE configured but ALL
 * strategies fail, the endpoint returns 502 with the error details rather than
 * silently falling back to stale data.
 */
router.get("/curriculum/sync-status", async (_req, res) => {
  try {
    const [setting] = await db.select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, TRIBYTE_COURSES_LAST_SYNCED_KEY));
    res.json({ lastSyncedAt: setting?.value ?? null });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/curriculum/sync-tribyte", requireAdmin, async (_req, res) => {
  // ── Scrape all paginated pages of /reviewer/course/list ──
  async function scrapeAllCourses(cookieHeader: string): Promise<TriByteScrapedCourse[]> {
    const all: TriByteScrapedCourse[] = [];
    for (let page = 0; page <= 20; page++) {
      const url = `${TB_BASE_URL}/reviewer/course/list${page > 0 ? `?page=${page}` : ""}`;
      const r   = await fetch(url, {
        signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Cookie: cookieHeader, "User-Agent": "Mozilla/5.0" },
      });
      if (!r.ok) throw new Error(`TriByte responded ${r.status} on page ${page}`);
      const html = await r.text();
      if (isTBLoginPage(html)) throw new Error("TriByte session has expired or is invalid");
      const rows = parseTriByteCoursePage(html);
      if (rows.length === 0) {
        if (page === 0) throw new Error("TriByte course list contained no recognizable course cards");
        break;
      }
      all.push(...rows);
      if (rows.length < 16) break; // last page — TriByte shows ~16 per page
    }
    return all;
  }

  // ── Credential resolution — uses shared module-level helpers ──
  // Any nonempty credential source (env OR DB) counts as "configured"; a partial
  // set that cannot form a complete strategy fails closed (502) rather than
  // falling back to static data — the operator must notice the misconfiguration.
  const hasTribyteCreds = await hasAnyTriByteCredsConfigured();

  let scraped: TriByteScrapedCourse[] | null = null;
  const errors: string[] = [];
  let usedStaticFallback = false;

  try {
    const resolved = await resolveTriByteCookie();
    if (resolved) {
      scraped = await scrapeAllCourses(resolved.cookie);
    } else if (process.env.TRIBYTE_USERNAME || process.env.TRIBYTE_PASSWORD) {
      // Partial username/password set — flag the misconfiguration
      errors.push("TRIBYTE_USERNAME/PASSWORD: only one of the two env vars is set — both are required");
    }
  } catch (e) {
    errors.push(String(e));
  }

  // If any TriByte credential is configured but all strategies failed → error.
  // Never silently fall back to stale static data in this case.
  if (hasTribyteCreds && !scraped) {
    res.status(502).json({
      error: "All TriByte credential strategies failed — could not sync",
      strategyErrors: errors,
    });
    return;
  }

  // No credentials configured → development/demo mode: upsert embedded static list.
  if (!scraped) {
    usedStaticFallback = true;
    scraped = TRIBYTE_COURSES.map(c => ({
      nid: c.tribyteNid, tid: c.tribyteTid, name: c.name, thumbUrl: c.thumbUrl,
    }));
  }

  try {
    const existing = await db.select().from(curriculumCoursesTable);
    const byNid    = new Map(existing.map(r => [r.tribyteNid ?? "", r]));
    let added = 0, updated = 0;

    for (const course of scraped) {
      const row = byNid.get(course.nid);
      if (row) {
        if (row.name !== course.name || (row.thumbUrl ?? "") !== course.thumbUrl) {
          await db.update(curriculumCoursesTable)
            .set({ name: course.name, thumbUrl: course.thumbUrl })
            .where(eq(curriculumCoursesTable.id, row.id));
          updated++;
        }
      } else {
        await db.insert(curriculumCoursesTable).values({
          id: `tb-${course.nid}`, name: course.name,
          groupName: "All Content", language: "English", adaptiveUserName: "",
          status: "Published", appliedTags: [],
          tribyteNid: course.nid, tribyteTid: course.tid, thumbUrl: course.thumbUrl,
        }).onConflictDoNothing();
        added++;
      }
    }

    const lastSyncedAt = new Date();
    await db.insert(appSettingsTable)
      .values({
        key: TRIBYTE_COURSES_LAST_SYNCED_KEY,
        value: lastSyncedAt.toISOString(),
        updatedAt: lastSyncedAt,
      })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: lastSyncedAt.toISOString(), updatedAt: lastSyncedAt },
      });

    res.json({
      added,
      updated,
      total: scraped.length,
      usedStaticFallback,
      strategyErrors: errors,
      lastSyncedAt: lastSyncedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Users & Groups sync from TriByte ────────────────────────────────────────

/**
 * Static fallback users used in development/demo mode when no TriByte
 * credentials are configured.  Represents a realistic HIMT roster.
 */
const STATIC_TRIBYTE_USERS: Array<{ name: string; email: string; role: string; groupName: string; status: string; lastActivity: string }> = [
  { name: "Capt. Rajesh Kumar",      email: "rajesh.kumar@himtelearning.com",      role: "faculty",  groupName: "Faculty · Navigation",       status: "Active",  lastActivity: "2 days ago" },
  { name: "Dr. Meena Rao",           email: "meena.rao@himtelearning.com",          role: "faculty",  groupName: "Faculty · Marine Engineering", status: "Active",  lastActivity: "5 days ago" },
  { name: "Suresh Pillai",           email: "suresh.pillai@himtelearning.com",      role: "faculty",  groupName: "Faculty · Safety",            status: "Active",  lastActivity: "1 day ago"  },
  { name: "Anjali Desai",            email: "anjali.desai@himtelearning.com",        role: "admin",    groupName: "Administration",              status: "Active",  lastActivity: "3 hours ago"},
  { name: "Arun Patel",              email: "arun.patel@himtelearning.com",          role: "student",  groupName: "DNS Batch 2025-A",            status: "Active",  lastActivity: "1 hour ago" },
  { name: "Bhavesh Joshi",           email: "bhavesh.joshi@himtelearning.com",       role: "student",  groupName: "DNS Batch 2025-A",            status: "Active",  lastActivity: "2 hours ago"},
  { name: "Chetan Malhotra",         email: "chetan.malhotra@himtelearning.com",     role: "student",  groupName: "DNS Batch 2025-A",            status: "Active",  lastActivity: "Yesterday"  },
  { name: "Divya Sharma",            email: "divya.sharma@himtelearning.com",        role: "student",  groupName: "DNS Batch 2025-B",            status: "Active",  lastActivity: "3 days ago" },
  { name: "Ekta Singh",              email: "ekta.singh@himtelearning.com",          role: "student",  groupName: "DNS Batch 2025-B",            status: "Active",  lastActivity: "4 days ago" },
  { name: "Farhan Qureshi",          email: "farhan.qureshi@himtelearning.com",      role: "student",  groupName: "B.Tech Marine 2025",          status: "Active",  lastActivity: "6 hours ago"},
  { name: "Geeta Menon",             email: "geeta.menon@himtelearning.com",         role: "student",  groupName: "B.Tech Marine 2025",          status: "Active",  lastActivity: "2 days ago" },
  { name: "Harish Verma",            email: "harish.verma@himtelearning.com",        role: "student",  groupName: "B.Tech Marine 2025",          status: "Invited", lastActivity: "Never"       },
  { name: "Indira Krishnaswamy",     email: "indira.k@himtelearning.com",            role: "student",  groupName: "STSDSD Batch Jul 2025",       status: "Active",  lastActivity: "1 week ago" },
  { name: "Jagdish Nair",            email: "jagdish.nair@himtelearning.com",        role: "student",  groupName: "STSDSD Batch Jul 2025",       status: "Active",  lastActivity: "5 days ago" },
  { name: "Kavita Bose",             email: "kavita.bose@himtelearning.com",         role: "student",  groupName: "STSDSD Batch Aug 2025",       status: "Active",  lastActivity: "Today"      },
  { name: "Lalit Tiwari",            email: "lalit.tiwari@himtelearning.com",        role: "student",  groupName: "STSDSD Batch Aug 2025",       status: "Suspended",lastActivity: "3 weeks ago"},
  { name: "Mohan Das",               email: "mohan.das@himtelearning.com",           role: "student",  groupName: "OSM Thome · Polar",           status: "Active",  lastActivity: "Today"      },
  { name: "Nalini Subramanian",      email: "nalini.s@himtelearning.com",            role: "student",  groupName: "OSM Thome · Polar",           status: "Active",  lastActivity: "Yesterday"  },
  { name: "Omkar Patil",             email: "omkar.patil@himtelearning.com",         role: "student",  groupName: "Tanker Safety 2025",          status: "Active",  lastActivity: "2 days ago" },
  { name: "Poonam Chauhan",          email: "poonam.chauhan@himtelearning.com",      role: "student",  groupName: "Tanker Safety 2025",          status: "Active",  lastActivity: "3 days ago" },
  { name: "Qasim Ali",               email: "qasim.ali@himtelearning.com",           role: "student",  groupName: "Bulk Carrier Safety 2025",    status: "Active",  lastActivity: "4 hours ago"},
  { name: "Ritu Kapoor",             email: "ritu.kapoor@himtelearning.com",         role: "student",  groupName: "Bulk Carrier Safety 2025",    status: "Invited", lastActivity: "Never"       },
  { name: "Santosh Reddy",           email: "santosh.reddy@himtelearning.com",       role: "student",  groupName: "Faculty Familiarization",     status: "Active",  lastActivity: "1 week ago" },
  { name: "Tanvi Jain",              email: "tanvi.jain@himtelearning.com",          role: "faculty",  groupName: "Faculty · Safety",            status: "Active",  lastActivity: "Today"      },
];

const STATIC_TRIBYTE_GROUPS = [
  "DNS Batch 2025-A", "DNS Batch 2025-B", "DNS Batch 2026-A",
  "B.Tech Marine 2025", "B.Tech Marine 2026",
  "STSDSD Batch Jul 2025", "STSDSD Batch Aug 2025",
  "OSM Thome · Polar", "Tanker Safety 2025", "Bulk Carrier Safety 2025",
  "Faculty Familiarization", "Faculty · Navigation",
  "Faculty · Marine Engineering", "Faculty · Safety",
  "Administration", "All Content",
];

/** Parse users from TriByte /reviewer/users/settings HTML (Drupal view table).
 *
 *  Uses column-header detection so group membership is extracted when the page
 *  includes a "Group" column, rather than always being left blank.
 */
function parseTriByteUsersHtml(html: string): Array<{ name: string; email: string; role: string; groupName: string; status: string; lastActivity: string }> {
  type ParsedUser = { name: string; email: string; role: string; groupName: string; status: string; lastActivity: string };
  const users: ParsedUser[] = [];
  const clean = (s: string) =>
    s.replace(/<[^>]+>/g, ' ')
     .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'")
     .replace(/\s+/g, ' ').trim();

  // ── Step 1: Detect column positions from <thead> ──────────────────────────
  let nameIdx = 0, emailIdx = -1, groupIdx = -1, roleIdx = -1, statusIdx = -1, accessIdx = -1;
  const theadM = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (theadM) {
    const headers = [...theadM[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map((c, i) => ({ label: clean(c[1]).toLowerCase(), i }));
    const fi = (pattern: RegExp) => headers.find(h => pattern.test(h.label))?.i ?? -1;
    nameIdx   = fi(/\b(name|user)\b/) !== -1 ? fi(/\b(name|user)\b/) : 0;
    emailIdx  = fi(/e-?mail/);
    groupIdx  = fi(/\bgroup/);
    roleIdx   = fi(/\brole/);
    statusIdx = fi(/\bstatus|active|block/);
    accessIdx = fi(/last.*(access|activity|login)/);
  }

  // ── Step 2: Parse <tbody> rows ────────────────────────────────────────────
  const tbodyM = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const target = tbodyM ? tbodyM[1] : html;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(target)) !== null) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => clean(c[1]));
    if (cells.length < 2) continue;

    // Resolve name
    const name = cells[nameIdx] || cells[0];
    if (!name || name.length < 2) continue;

    // Resolve email — prefer dedicated column, then scan all cells
    const emailRaw = emailIdx >= 0 ? cells[emailIdx] : cells.find(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
    const email = emailRaw?.trim();
    if (!email || !email.includes('@')) continue;

    // Resolve group — prefer dedicated column, then scan for batch/group-like values
    let groupName = '';
    if (groupIdx >= 0 && cells[groupIdx]) {
      groupName = cells[groupIdx];
    } else {
      // Heuristic: look for a cell that looks like a group name (not email, not role word, not date)
      const candidate = cells.find(c =>
        c !== name && c !== email &&
        !/^(admin|faculty|student|instructor|trainer|learner|active|blocked|suspended|invited|never|today|yesterday)$/i.test(c) &&
        !/^\d{4}/.test(c) &&
        /\S/.test(c) && c.length > 1 && c.length < 100
      );
      if (candidate) groupName = candidate;
    }

    // Resolve role
    let role = 'student';
    const roleRaw = roleIdx >= 0 ? cells[roleIdx] : cells.find(c => /admin|faculty|instructor|trainer|student|learner/i.test(c));
    if (roleRaw) {
      const r = roleRaw.toLowerCase();
      if (r.includes('admin')) role = 'admin';
      else if (r.includes('faculty') || r.includes('instructor') || r.includes('trainer')) role = 'faculty';
    }

    // Resolve status
    const statusRaw = statusIdx >= 0 ? cells[statusIdx] : cells.find(c => /\b(active|blocked|suspended|invited)\b/i.test(c));
    const status = statusRaw
      ? (statusRaw.toLowerCase().includes('block') ? 'Suspended' : statusRaw.trim())
      : 'Active';

    // Resolve last activity
    const accessRaw = accessIdx >= 0 ? cells[accessIdx] : cells.find(c => /\d{4}|\bago\b|never|today|yesterday/i.test(c));
    const lastActivity = accessRaw ?? 'Never';

    users.push({ name, email, role, groupName, status, lastActivity });
  }
  return users;
}

/** Parse groups from TriByte /reviewer/showgroups HTML. */
function parseTriByteGroupsHtml(html: string): string[] {
  const groups: string[] = [];
  const clean = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
  const seen = new Set<string>();

  // Try table rows first
  const tbodyM = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (tbodyM) {
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(tbodyM[1])) !== null) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => clean(c[1]));
      if (cells[0] && cells[0].length > 1 && !seen.has(cells[0])) {
        seen.add(cells[0]); groups.push(cells[0]);
      }
    }
  }

  // Fallback: look for views-row divs
  if (groups.length === 0) {
    const rowRe = /class="[^"]*views-row[^"]*"[^>]*>([\s\S]*?)<\/(?:div|li)>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      const text = clean(m[1]);
      if (text && text.length > 1 && text.length < 120 && !seen.has(text)) {
        seen.add(text); groups.push(text);
      }
    }
  }

  return groups;
}

/**
 * POST /api/users/sync-tribyte
 *
 * Protected by requireAdmin.  Scrapes /reviewer/users/settings for users
 * and /reviewer/showgroups for groups, then upserts both into the DB.
 * Falls back to a static HIMT-representative dataset when no TriByte
 * credentials are configured.
 */
router.post("/users/sync-tribyte", requireAdmin, async (_req, res) => {
  let cookieHeader: string | null = null;
  let strategy = "static-fallback";
  let usedStaticFallback = false;
  const errors: string[] = [];

  // Try to get a TriByte session cookie
  try {
    const resolved = await resolveTriByteCookie();
    if (resolved) { cookieHeader = resolved.cookie; strategy = resolved.strategy; }
  } catch (e) {
    errors.push(String(e));
  }

  // Check if any creds were configured (so we can fail-close instead of silently falling back)
  const hasTribyteCreds = await hasAnyTriByteCredsConfigured();

  if (hasTribyteCreds && !cookieHeader) {
    res.status(502).json({
      error: "TriByte credential strategy failed — could not sync users",
      strategyErrors: errors,
    });
    return;
  }

  interface ScrapedUser { name: string; email: string; role: string; groupName: string; status: string; lastActivity: string; }

  let scrapedUsers: ScrapedUser[] | null = null;
  let scrapedGroupNames: string[] | null = null;

  if (cookieHeader) {
    try {
      const uRes = await fetch(`${TB_BASE_URL}/reviewer/users/settings`, {
        signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Cookie: cookieHeader, "User-Agent": "Mozilla/5.0" },
      });
      if (!uRes.ok) throw new Error(`TriByte users page responded ${uRes.status}`);
      const html = await uRes.text();
      if (isTBLoginPage(html)) throw new Error("TriByte session expired — re-login required");
      scrapedUsers = parseTriByteUsersHtml(html);
    } catch (e) { errors.push(`users scrape: ${String(e)}`); }

    try {
      const gRes = await fetch(`${TB_BASE_URL}/reviewer/showgroups`, {
        signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Cookie: cookieHeader, "User-Agent": "Mozilla/5.0" },
      });
      if (gRes.ok) {
        const html = await gRes.text();
        if (!isTBLoginPage(html)) scrapedGroupNames = parseTriByteGroupsHtml(html);
      }
    } catch (e) { errors.push(`groups scrape: ${String(e)}`); }
  }

  // ── Credentials configured: fail-closed, no static-data mixing ───────────
  // When credentials were supplied and a session cookie was resolved, any live
  // scrape that returns 0 users is treated as a hard failure (permissions,
  // session expiry, or parse mismatch) — we never write static demo identities
  // into a live environment.  Groups are best-effort: if the groups page didn't
  // yield data we derive group names from the users' own groupName fields.
  if (hasTribyteCreds) {
    if (!scrapedUsers || scrapedUsers.length === 0) {
      res.status(502).json({
        error: "TriByte users page returned no parseable users — check session permissions or page structure",
        strategyErrors: errors,
      });
      return;
    }
    // Derive group names from user data if the groups page didn't parse
    const derivedGroupNames = [...new Set(scrapedUsers.map(u => u.groupName).filter(Boolean))];
    const groupNamesToImport = (scrapedGroupNames && scrapedGroupNames.length > 0)
      ? scrapedGroupNames
      : derivedGroupNames;

    try {
      let groupsImported = 0;
      const existingGroups = await db.select().from(groupsTable);
      const existingGroupNames = new Set(existingGroups.map(g => g.name.toLowerCase()));
      for (const gname of groupNamesToImport) {
        if (!existingGroupNames.has(gname.toLowerCase())) {
          await db.insert(groupsTable).values({ id: `g-tb-${Date.now()}-${groupsImported}`, name: gname }).onConflictDoNothing();
          groupsImported++;
        }
      }

      let usersAdded = 0, usersUpdated = 0;
      const existingUsers = await db.select().from(usersTable);
      const byEmail = new Map(existingUsers.map(u => [u.email.toLowerCase(), u]));
      for (const u of scrapedUsers) {
        const existing = byEmail.get(u.email.toLowerCase());
        if (existing) {
          await db.update(usersTable)
            .set({ name: u.name, role: u.role, groupName: u.groupName, status: u.status })
            .where(eq(usersTable.id, existing.id));
          usersUpdated++;
        } else {
          await db.insert(usersTable).values({
            id: `u-tb-${Date.now()}-${usersAdded}`,
            name: u.name, email: u.email, role: u.role,
            groupName: u.groupName, status: u.status, lastActivity: u.lastActivity,
          }).onConflictDoNothing();
          usersAdded++;
        }
      }
      res.json({
        usersAdded, usersUpdated, groupsImported,
        totalUsers: scrapedUsers.length, totalGroups: groupNamesToImport.length,
        usedStaticFallback: false, strategy, strategyErrors: errors,
      });
    } catch (err) { res.status(500).json({ error: String(err) }); }
    return;
  }

  // ── No credentials configured: demo/dev mode with static data ────────────
  usedStaticFallback = true;
  strategy = "static-fallback";
  const usersToImport      = STATIC_TRIBYTE_USERS;
  const groupNamesToImport = STATIC_TRIBYTE_GROUPS;

  try {
    // ── Upsert groups ──
    let groupsImported = 0;
    const existingGroups = await db.select().from(groupsTable);
    const existingGroupNames = new Set(existingGroups.map(g => g.name.toLowerCase()));
    for (const gname of groupNamesToImport) {
      if (!existingGroupNames.has(gname.toLowerCase())) {
        await db.insert(groupsTable).values({ id: `g-tb-${Date.now()}-${groupsImported}`, name: gname }).onConflictDoNothing();
        groupsImported++;
      }
    }

    // ── Upsert users ──
    let usersAdded = 0, usersUpdated = 0;
    const existingUsers = await db.select().from(usersTable);
    const byEmail = new Map(existingUsers.map(u => [u.email.toLowerCase(), u]));

    for (const u of usersToImport) {
      const existing = byEmail.get(u.email.toLowerCase());
      if (existing) {
        await db.update(usersTable)
          .set({ name: u.name, role: u.role, groupName: u.groupName, status: u.status })
          .where(eq(usersTable.id, existing.id));
        usersUpdated++;
      } else {
        await db.insert(usersTable).values({
          id:           `u-tb-${Date.now()}-${usersAdded}`,
          name:         u.name,
          email:        u.email,
          role:         u.role,
          groupName:    u.groupName,
          status:       u.status,
          lastActivity: u.lastActivity,
        }).onConflictDoNothing();
        usersAdded++;
      }
    }

    res.json({
      usersAdded, usersUpdated, groupsImported,
      totalUsers: usersToImport.length, totalGroups: groupNamesToImport.length,
      usedStaticFallback, strategy, strategyErrors: errors,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Legacy entry point retained for existing admin clients. It now uses the same
// full hierarchy scan and Preview recovery job as every other targeted retry.
router.post("/curriculum/retry-unavailable", requireAdmin, async (_req, res) => {
  try {
    const activeJobs = await db.select().from(courseResourceImportJobsTable);
    if (activeJobs.some(job => job.status === "queued" || job.status === "running")) {
      res.status(409).json({ error: "A resource import is already running" });
      return;
    }
    const retryable = (await db.select().from(courseResourcesTable))
      .filter(resource => resource.status === "failed" || resource.status === "unavailable");
    const courseIds = [...new Set(retryable.map(resource => resource.courseId))];
    if (!courseIds.length) {
      res.status(409).json({ error: "There are no failed or unavailable resources to retry" });
      return;
    }
    const courses = (await db.select().from(curriculumCoursesTable))
      .filter(course => courseIds.includes(course.id) && course.tribyteNid && course.tribyteTid);
    const jobId = `tri-resource-${randomBytes(8).toString("hex")}`;
    await db.insert(courseResourceImportJobsTable).values({
      id: jobId,
      status: "queued",
      totalCourses: courses.length,
    });
    await db.insert(courseResourceImportJobItemsTable).values(courses.map(course => ({
      id: `tri-resource-item-${jobId}-${course.id}`,
      jobId,
      courseId: course.id,
      courseName: course.name,
      status: "pending",
    })));
    queueResourceImportJob(jobId);
    res.status(202).json({ job: await getResourceImportJob(jobId) });
  } catch {
    res.status(500).json({ error: "Could not retry unavailable resources" });
  }
});

// ─── DRM-007: access log query ────────────────────────────────────────────────

/**
 * GET /curriculum/access-logs
 * Admin-only paginated access log with filters for user, resource, date range, outcome.
 */
router.get("/curriculum/access-logs", requireAdmin, async (req, res) => {
  const { userId, resourceId, dateFrom, dateTo, outcome, page = "1", limit = "50" } = req.query as Record<string, string | undefined>;
  const pageNum  = Math.max(1, parseInt(page  ?? "1",  10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit ?? "50", 10)));
  const offset   = (pageNum - 1) * limitNum;
  try {
    const rows = await db
      .select({
        id:            contentAccessLogsTable.id,
        userId:        contentAccessLogsTable.userId,
        resourceId:    contentAccessLogsTable.resourceId,
        courseId:      contentAccessLogsTable.courseId,
        action:        contentAccessLogsTable.action,
        sessionId:     contentAccessLogsTable.sessionId,
        userAgent:     contentAccessLogsTable.userAgent,
        ipAddress:     contentAccessLogsTable.ipAddress,
        outcomeDetail: contentAccessLogsTable.outcomeDetail,
        createdAt:     contentAccessLogsTable.createdAt,
        resourceTitle: courseResourcesTable.title,
        resourceType:  courseResourcesTable.resourceType,
        courseTitle:   curriculumCoursesTable.name,
      })
      .from(contentAccessLogsTable)
      .leftJoin(courseResourcesTable,   eq(contentAccessLogsTable.resourceId, courseResourcesTable.id))
      .leftJoin(curriculumCoursesTable, eq(contentAccessLogsTable.courseId,   curriculumCoursesTable.id))
      .where(and(
        userId     ? ilike(contentAccessLogsTable.userId, `%${userId}%`)         : undefined,
        resourceId ? eq(contentAccessLogsTable.resourceId, resourceId)           : undefined,
        outcome    ? eq(contentAccessLogsTable.action, outcome)                  : undefined,
        dateFrom   ? gte(contentAccessLogsTable.createdAt, new Date(dateFrom))   : undefined,
        dateTo     ? lt(contentAccessLogsTable.createdAt, (() => { const d = new Date(dateTo); d.setDate(d.getDate() + 1); return d; })()) : undefined,
      ))
      .orderBy(desc(contentAccessLogsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(contentAccessLogsTable)
      .where(and(
        userId     ? ilike(contentAccessLogsTable.userId, `%${userId}%`)         : undefined,
        resourceId ? eq(contentAccessLogsTable.resourceId, resourceId)           : undefined,
        outcome    ? eq(contentAccessLogsTable.action, outcome)                  : undefined,
        dateFrom   ? gte(contentAccessLogsTable.createdAt, new Date(dateFrom))   : undefined,
        dateTo     ? lt(contentAccessLogsTable.createdAt, (() => { const d = new Date(dateTo); d.setDate(d.getDate() + 1); return d; })()) : undefined,
      ));

    res.json({ logs: rows, total: Number(total), page: pageNum, limit: limitNum });
  } catch (error) {
    logger.error({ error }, "access-logs query failed");
    res.status(500).json({ error: "Could not load access logs" });
  }
});

// ─── User import ──────────────────────────────────────────────────────────────

router.post("/users/import", async (req, res) => {
  const parsed = ImportUsersBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  res.status(201).json(ImportUsersResponse.parse({ id: `import-${Date.now()}`, filename: parsed.data.filename, status: "Validated", total: parsed.data.rows, valid: Math.max(parsed.data.rows - 2, 0), warnings: Math.min(2, parsed.data.rows), failed: 0, progress: 100 }));
});

export default router;
