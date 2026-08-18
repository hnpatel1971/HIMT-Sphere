import { Router, type IRouter } from "express";
import "express-session"; // ensure SessionData augmentation from auth.ts is loaded
import { eq, ilike, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  courses as coursesTable,
  assignments as assignmentsTable,
  announcements as announcementsTable,
  sessions as sessionsTable,
  certificates as certificatesTable,
  users as usersTable,
  programmes as programmesTable,
  programmeCourses as programmeCoursesTable,
  courseOutlines as courseOutlinesTable,
  curriculumCourses as curriculumCoursesTable,
  courseTopics as courseTopicsTable,
  courseSubtopics as courseSubtopicsTable,
  groups as groupsTable,
  tags as tagsTable,
  glossaryTerms as glossaryTable,
  uploadJobs as uploadJobsTable,
  faqCategories as faqTable,
} from "@workspace/db";
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
      { id: "activity-navigation", title: "Navigation Rules & Watchkeeping", type: "Protected document", duration: "18 min", status: "complete", protected: true },
    ],
  },
  {
    id: "topic-02",
    title: "02 · Bridge team operations",
    duration: "2h 10m",
    progress: 46,
    locked: false,
    activities: [
      { id: "activity-bridge", title: "Bridge Resource Management", type: "Video lesson", duration: "24 min", status: "current", protected: true },
      { id: "activity-quiz",   title: "Knowledge check: Bridge procedures", type: "Quiz", duration: "12 questions", status: "locked", protected: false },
    ],
  },
  {
    id: "topic-03",
    title: "03 · Passage planning",
    duration: "1h 45m",
    progress: 0,
    locked: true,
    activities: [
      { id: "activity-passage", title: "Passage planning checklist", type: "Practical activity", duration: "30 min", status: "locked", protected: false },
    ],
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
    await db.insert(curriculumCoursesTable).values(TRIBYTE_COURSES).onConflictDoNothing();
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

// Fire-and-forget seed on startup
seedDatabase().catch(err => console.error("[seed] Failed:", err));
syncTriByteCourses().catch(err => console.error("[sync] Failed:", err));

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
    let rows = await db.select().from(coursesTable);
    const search = parsed.data.search?.toLowerCase();
    const status = parsed.data.status?.toLowerCase();
    if (search) rows = rows.filter(c => c.name.toLowerCase().includes(search) || c.code.toLowerCase().includes(search));
    if (status) rows = rows.filter(c => c.status.toLowerCase().includes(status));
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
    const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, params.data.courseId));
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }
    res.json(GetCourseResponse.parse({ ...course, description: "Build confident, compliant bridge teams through applied navigation, regulations and watchkeeping practice.", objectives: ["Apply safe navigation principles in operational scenarios","Coordinate bridge teams using clear communication","Prepare and review a compliant passage plan"], topics: topicDetail }));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/assignments", async (req, res) => {
  const parsed = ListAssignmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    let rows = await db.select().from(assignmentsTable);
    const status = parsed.data.status?.toLowerCase();
    if (status) rows = rows.filter(a => a.status.toLowerCase().includes(status));
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
  try { res.json(ListAnnouncementsResponse.parse(await db.select().from(announcementsTable))); }
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
  try { res.json(ListUsersResponse.parse(await db.select().from(usersTable))); }
  catch (err) { res.status(500).json({ error: String(err) }); }
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
  try { res.json(await db.select().from(groupsTable)); }
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
    const result = topics.map(t => ({
      ...t,
      subtopics: subtopics.filter(s => s.topicId === t.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
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

// Update a topic
router.patch("/curriculum/topics/:topicId", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  try {
    const updates: Record<string, unknown> = {};
    if (body.name     !== undefined) updates.name     = body.name;
    if (body.thumbUrl !== undefined) updates.thumbUrl = body.thumbUrl;
    if (body.faculty  !== undefined) updates.faculty  = body.faculty;
    if (body.order    !== undefined) updates.order    = body.order;
    await db.update(courseTopicsTable).set(updates).where(eq(courseTopicsTable.id, req.params.topicId));
    const [updated] = await db.select().from(courseTopicsTable).where(eq(courseTopicsTable.id, req.params.topicId));
    res.json(updated ?? { ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// Delete a topic (and its subtopics)
router.delete("/curriculum/topics/:topicId", async (req, res) => {
  try {
    await db.delete(courseSubtopicsTable).where(eq(courseSubtopicsTable.topicId, req.params.topicId));
    await db.delete(courseTopicsTable).where(eq(courseTopicsTable.id, req.params.topicId));
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

// Import topics (and sub-topics) from TriByte for a curriculum course.
// Scrapes /reviewer/topics?cat={tid}&catspec=true, parses the carousel HTML,
// and stores both top-level topics and any nested subtopics.
router.post("/curriculum/courses/:id/topics/import", async (req, res) => {
  try {
    const [course] = await db.select().from(curriculumCoursesTable)
      .where(eq(curriculumCoursesTable.id, req.params.id));
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }
    if (!course.tribyteTid) { res.status(400).json({ error: "Course has no TriByte TID — cannot import" }); return; }

    const sessionCookie = process.env.TRIBYTE_SESSION;
    if (!sessionCookie) {
      res.status(400).json({ error: "TRIBYTE_SESSION env var not set — cannot scrape TriByte" });
      return;
    }

    const url = `https://admin.learn.himtelearning.com/reviewer/topics?cat=${course.tribyteTid}&catspec=true`;
    const htmlRes = await fetch(url, { headers: { Cookie: sessionCookie, "User-Agent": "Mozilla/5.0" } });
    if (!htmlRes.ok) { res.status(502).json({ error: `TriByte responded ${htmlRes.status}` }); return; }
    const html = await htmlRes.text();

    // ── Step 1: Collect all <li data-nid="NID"> positions and their inner HTML ──
    interface LiNidItem {
      pos: number; nid: string; innerStart: number;
      depth: number; innerHtml: string;
    }
    const nidItems: LiNidItem[] = [];
    const liTagRe = /<li([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = liTagRe.exec(html)) !== null) {
      const nidMatch = m[1].match(/\bdata-nid="(\d+)"/);
      if (nidMatch) {
        const innerStart = m.index + m[0].length;
        nidItems.push({ pos: m.index, nid: nidMatch[1], innerStart, depth: 0, innerHtml: '' });
      }
    }

    // ── Step 2: Compute nesting depth by counting opens/closes before each item ──
    for (const item of nidItems) {
      const before = html.slice(0, item.pos);
      const opens  = (before.match(/<li[\s>]/g) || []).length;
      const closes = (before.match(/<\/li>/g)   || []).length;
      item.depth = opens - closes;
    }

    // ── Step 3: Capture each item's inner HTML (handles nested <li> correctly) ──
    for (const item of nidItems) {
      const endPos = findLiBlockEnd(html, item.innerStart);
      item.innerHtml = html.slice(item.innerStart, endPos);
    }

    if (nidItems.length === 0) {
      res.status(200).json({ imported: 0, subtopicsImported: 0, topics: [], message: "No topics found on TriByte page" });
      return;
    }

    // ── Step 4: Split into topics (minimum depth) and subtopics (deeper) ──
    const minDepth   = Math.min(...nidItems.map(i => i.depth));
    const topicItems = nidItems.filter(i => i.depth === minDepth);
    const subItems   = nidItems.filter(i => i.depth >  minDepth);

    // ── Step 5: Clear existing data ──
    const existingTopics = await db.select().from(courseTopicsTable)
      .where(eq(courseTopicsTable.courseId, req.params.id));
    for (const t of existingTopics) {
      await db.delete(courseSubtopicsTable).where(eq(courseSubtopicsTable.topicId, t.id));
    }
    await db.delete(courseTopicsTable).where(eq(courseTopicsTable.courseId, req.params.id));

    // ── Step 6: Insert topics ──
    const topicRows = topicItems.map((t, i) => ({
      id:       `ct-${course.tribyteTid}-${t.nid}`,
      courseId: req.params.id,
      nid:      t.nid,
      tid:      course.tribyteTid ?? "",
      name:     extractTopicName(t.innerHtml, t.nid),
      order:    i,
      thumbUrl: extractTopicThumb(t.innerHtml),
      faculty:  "",
    }));
    if (topicRows.length) await db.insert(courseTopicsTable).values(topicRows);

    // ── Step 7: Insert subtopics — each under the nearest preceding topic ──
    let subtopicsInserted = 0;
    // track per-topic subtopic order
    const subOrderByTopic: Record<string, number> = {};

    for (const sub of subItems) {
      // nearest preceding topic in document order
      const parentTopic = [...topicItems].reverse().find(t => t.pos < sub.pos);
      if (!parentTopic) continue;
      const topicRow = topicRows.find(r => r.nid === parentTopic.nid);
      if (!topicRow) continue;

      const topicId = topicRow.id;
      const subOrder = subOrderByTopic[topicId] ?? 0;
      subOrderByTopic[topicId] = subOrder + 1;

      await db.insert(courseSubtopicsTable).values({
        id:       `cs-${course.tribyteTid}-${sub.nid}`,
        topicId,
        courseId: req.params.id,
        nid:      sub.nid,
        name:     extractTopicName(sub.innerHtml, sub.nid),
        order:    subOrder,
      }).onConflictDoNothing();
      subtopicsInserted++;
    }

    res.status(201).json({
      imported: topicRows.length,
      subtopicsImported: subtopicsInserted,
      topics: topicRows,
    });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ─── Sync courses from TriByte ────────────────────────────────────────────────

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
router.post("/curriculum/sync-tribyte", requireAdmin, async (_req, res) => {
  const TB_BASE = "https://admin.learn.himtelearning.com";

  interface ScrapedCourse { nid: string; tid: string; name: string; thumbUrl: string; }

  // ── Detect a TriByte login-redirect page (session expired / bad cookie) ──
  function isLoginPage(html: string): boolean {
    return html.includes("user/login") && html.includes("form_build_id");
  }

  // ── Parse all course cards from one page of /reviewer/course/list ──
  function parseCoursePage(html: string): ScrapedCourse[] {
    const results: ScrapedCourse[] = [];
    const cardRe = /<li[^>]*class="[^"]*views-row[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
    let m: RegExpExecArray | null;
    while ((m = cardRe.exec(html)) !== null) {
      const inner = m[1];
      const nidM  = inner.match(/\/node\/(\d+)\/edit\/course/);
      const tidM  = inner.match(/cat_tid=(\d+)/) || inner.match(/cat=(\d+)/);
      const nameM = inner.match(/class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|h\d|a)>/)
                 || inner.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/);
      const thumbM = inner.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp)[^"]*)"/i)
                  || inner.match(/src="([^"]*static[^"]+)"/i);
      if (nidM && tidM) {
        results.push({
          nid:      nidM[1],
          tid:      tidM[1],
          name:     nameM ? cleanHtml(nameM[1]) : `Course ${nidM[1]}`,
          thumbUrl: thumbM?.[1] ?? "",
        });
      }
    }
    return results;
  }

  // 30-second timeout per TriByte request so an unresponsive server cannot leave
  // the sync handler pending indefinitely.
  const FETCH_TIMEOUT_MS = 30_000;

  // ── Scrape all paginated pages of /reviewer/course/list ──
  async function scrapeAllCourses(cookieHeader: string): Promise<ScrapedCourse[]> {
    const all: ScrapedCourse[] = [];
    for (let page = 0; page <= 20; page++) {
      const url = `${TB_BASE}/reviewer/course/list${page > 0 ? `?page=${page}` : ""}`;
      const r   = await fetch(url, {
        signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Cookie: cookieHeader, "User-Agent": "Mozilla/5.0" },
      });
      if (!r.ok) throw new Error(`TriByte responded ${r.status} on page ${page}`);
      const html = await r.text();
      if (isLoginPage(html)) throw new Error("TriByte session has expired or is invalid");
      const rows = parseCoursePage(html);
      if (rows.length === 0) break;
      all.push(...rows);
      if (rows.length < 16) break; // last page — TriByte shows ~16 per page
    }
    return all;
  }

  // ── Log into TriByte via Drupal form, return session cookie string ──
  async function loginToTriByte(tbUser: string, tbPass: string): Promise<string> {
    const loginPageRes = await fetch(`${TB_BASE}/user/login`, {
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const loginHtml  = await loginPageRes.text();
    const fbidMatch  = loginHtml.match(/name="form_build_id"\s+value="([^"]+)"/);
    if (!fbidMatch) throw new Error("Could not find form_build_id on TriByte login page");

    const body = new URLSearchParams({
      name: tbUser, pass: tbPass,
      form_build_id: fbidMatch[1], form_id: "user_login", op: "Log in",
    });
    const loginRes = await fetch(`${TB_BASE}/user/login?destination=reviewer/course/list`, {
      method:  "POST",
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" },
      body:    body.toString(),
      redirect: "manual",
    });
    const rawCookies = loginRes.headers.get("set-cookie") ?? "";
    if (!rawCookies) throw new Error("TriByte login did not return cookies — check credentials");
    return rawCookies.split(/,(?=[^ ])/).map(c => c.split(";")[0].trim()).join("; ");
  }

  // ── Determine whether any TriByte credential variable is set ──
  // Any nonempty credential env var counts as "configured"; a partial set that
  // cannot form a complete strategy fails closed (502) rather than falling back
  // to static data — the operator must notice the misconfiguration.
  const hasTribyteCreds =
    Boolean(process.env.TRIBYTE_SESSION) ||
    Boolean(process.env.TRIBYTE_USERNAME) ||
    Boolean(process.env.TRIBYTE_PASSWORD);

  let scraped: ScrapedCourse[] | null = null;
  const errors: string[] = [];
  let usedStaticFallback = false;

  // Strategy 1: TRIBYTE_SESSION env var
  const sessionCookie = process.env.TRIBYTE_SESSION;
  if (sessionCookie && !scraped) {
    try { scraped = await scrapeAllCourses(sessionCookie); }
    catch (e) { errors.push(`TRIBYTE_SESSION: ${String(e)}`); }
  }

  // Strategy 2: TRIBYTE_USERNAME + TRIBYTE_PASSWORD (both required; partial set is
  // flagged as a configuration error rather than silently skipped).
  const tbUser = process.env.TRIBYTE_USERNAME;
  const tbPass = process.env.TRIBYTE_PASSWORD;
  if (!scraped) {
    if (tbUser && tbPass) {
      try {
        const cookie = await loginToTriByte(tbUser, tbPass);
        scraped = await scrapeAllCourses(cookie);
      } catch (e) { errors.push(`TRIBYTE_USERNAME/PASSWORD: ${String(e)}`); }
    } else if (tbUser || tbPass) {
      errors.push(
        "TRIBYTE_USERNAME/PASSWORD: only one of the two env vars is set — both are required",
      );
    }
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

    res.json({ added, updated, total: scraped.length, usedStaticFallback, strategyErrors: errors });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── User import ──────────────────────────────────────────────────────────────

router.post("/users/import", async (req, res) => {
  const parsed = ImportUsersBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  res.status(201).json(ImportUsersResponse.parse({ id: `import-${Date.now()}`, filename: parsed.data.filename, status: "Validated", total: parsed.data.rows, valid: Math.max(parsed.data.rows - 2, 0), warnings: Math.min(2, parsed.data.rows), failed: 0, progress: 100 }));
});

export default router;
