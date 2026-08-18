import { Router, type IRouter } from "express";
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

  // Curriculum courses (TriByte-style admin list)
  await db.insert(curriculumCoursesTable).values([
    { id: "cl1", name: "ME-GI Course",                                    groupName: "All Content", language: "English", adaptiveUserName: "" },
    { id: "cl2", name: "Vertical Integration Course for Trainers – VICT", groupName: "All Content", language: "English", adaptiveUserName: "" },
    { id: "cl3", name: "Basic Safety Training (BST)",                     groupName: "All Content", language: "English", adaptiveUserName: "" },
    { id: "cl4", name: "STCW Advanced Fire Fighting",                     groupName: "All Content", language: "English", adaptiveUserName: "" },
    { id: "cl5", name: "GMDSS General Operator's Certificate",            groupName: "All Content", language: "English", adaptiveUserName: "" },
    { id: "cl6", name: "Bridge Resource Management (BRM)",                groupName: "All Content", language: "English", adaptiveUserName: "" },
    { id: "cl7", name: "Engine Room Simulator Training",                  groupName: "Engineering",  language: "English", adaptiveUserName: "" },
    { id: "cl8", name: "STCW 2017 Maritime Safety",                       groupName: "All Content", language: "English", adaptiveUserName: "" },
  ]).onConflictDoNothing();

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

// Fire-and-forget seed on startup
seedDatabase().catch(err => console.error("[seed] Failed:", err));

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

// ─── User import ──────────────────────────────────────────────────────────────

router.post("/users/import", async (req, res) => {
  const parsed = ImportUsersBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  res.status(201).json(ImportUsersResponse.parse({ id: `import-${Date.now()}`, filename: parsed.data.filename, status: "Validated", total: parsed.data.rows, valid: Math.max(parsed.data.rows - 2, 0), warnings: Math.min(2, parsed.data.rows), failed: 0, progress: 100 }));
});

export default router;
