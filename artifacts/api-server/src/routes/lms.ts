import { Router, type IRouter } from "express";
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
  ListAnnouncementsResponse,
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

const activities = [
  {
    id: "activity-navigation",
    title: "Navigation Rules & Watchkeeping",
    type: "Protected document",
    duration: "18 min",
    status: "complete",
    protected: true,
  },
  {
    id: "activity-bridge",
    title: "Bridge Resource Management",
    type: "Video lesson",
    duration: "24 min",
    status: "current",
    protected: true,
  },
  {
    id: "activity-quiz",
    title: "Knowledge check: Bridge procedures",
    type: "Quiz",
    duration: "12 questions",
    status: "locked",
    protected: false,
  },
];

const topics = [
  {
    id: "topic-01",
    title: "01 · Principles of safe navigation",
    duration: "1h 20m",
    progress: 100,
    locked: false,
    activities: [activities[0]],
  },
  {
    id: "topic-02",
    title: "02 · Bridge team operations",
    duration: "2h 10m",
    progress: 46,
    locked: false,
    activities: [activities[1], activities[2]],
  },
  {
    id: "topic-03",
    title: "03 · Passage planning",
    duration: "1h 45m",
    progress: 0,
    locked: true,
    activities: [
      {
        id: "activity-passage",
        title: "Passage planning checklist",
        type: "Practical activity",
        duration: "30 min",
        status: "locked",
        protected: false,
      },
    ],
  },
];

const courses = [
  {
    id: "course-bridge",
    code: "BMR-204",
    name: "Bridge Management & Regulations",
    category: "Advanced Modular",
    language: "English",
    status: "Published",
    progress: 68,
    learners: 128,
    duration: "18 hours",
    thumbnail: "bridge",
    nextActivity: "Bridge Resource Management",
    accent: "ocean",
  },
  {
    id: "course-safety",
    code: "PST-101",
    name: "Personal Safety & Social Responsibility",
    category: "Basic Modular",
    language: "English",
    status: "Published",
    progress: 42,
    learners: 246,
    duration: "12 hours",
    thumbnail: "safety",
    nextActivity: "Emergency response drill",
    accent: "amber",
  },
  {
    id: "course-cargo",
    code: "CCO-310",
    name: "Cargo Operations & Stowage",
    category: "Advanced Modular",
    language: "English",
    status: "Under Review",
    progress: 0,
    learners: 74,
    duration: "22 hours",
    thumbnail: "cargo",
    nextActivity: null,
    accent: "slate",
  },
  {
    id: "course-fire",
    code: "FPFF-110",
    name: "Fire Prevention & Fire Fighting",
    category: "Basic Modular",
    language: "English",
    status: "Published",
    progress: 100,
    learners: 312,
    duration: "16 hours",
    thumbnail: "fire",
    nextActivity: null,
    accent: "coral",
  },
];

const assignments = [
  {
    id: "assignment-passage",
    title: "Passage plan: Mumbai to Colombo",
    course: "Bridge Management & Regulations",
    dueDate: "18 Aug 2026",
    status: "Due soon",
    submitted: false,
    assessor: "Capt. A. Nair",
    priority: "high",
  },
  {
    id: "assignment-safety",
    title: "Emergency response reflection",
    course: "Personal Safety & Social Responsibility",
    dueDate: "23 Aug 2026",
    status: "In progress",
    submitted: false,
    assessor: "Ms. R. Joseph",
    priority: "normal",
  },
  {
    id: "assignment-cargo",
    title: "Cargo securing checklist",
    course: "Cargo Operations & Stowage",
    dueDate: "05 Aug 2026",
    status: "Feedback published",
    submitted: true,
    assessor: "Capt. S. Menon",
    priority: "normal",
  },
];

const announcements = [
  {
    id: "announcement-01",
    title: "August intake orientation",
    body: "Your academic orientation is scheduled for 20 August at the Navi Mumbai campus.",
    audience: "Navi Mumbai · August 2026 intake",
    publishedAt: "Today, 09:20",
    unread: true,
  },
  {
    id: "announcement-02",
    title: "Updated assessment policy",
    body: "Please review the revised resubmission and moderation policy before your next assessment.",
    audience: "All learners",
    publishedAt: "Yesterday",
    unread: false,
  },
];

const sessions = [
  {
    id: "session-01",
    title: "Live Q&A · Bridge operations",
    course: "Bridge Management & Regulations",
    type: "Webinar",
    date: "20 Aug 2026",
    time: "14:00 – 15:00",
    location: "Microsoft Teams",
    faculty: "Capt. A. Nair",
    attendance: "Not marked",
  },
  {
    id: "session-02",
    title: "Fire drill practical",
    course: "Fire Prevention & Fire Fighting",
    type: "Classroom",
    date: "22 Aug 2026",
    time: "09:30 – 12:00",
    location: "Safety Lab · Navi Mumbai",
    faculty: "Mr. V. D'Souza",
    attendance: "Required",
  },
];

const certificates = [
  {
    id: "certificate-01",
    title: "Personal Safety & Social Responsibility",
    course: "PST-101",
    issuedOn: "12 Jun 2026",
    expiresOn: null,
    status: "Verified",
    serial: "HIMT-PST-26-00418",
  },
  {
    id: "certificate-02",
    title: "Fire Prevention & Fire Fighting",
    course: "FPFF-110",
    issuedOn: "22 Jul 2026",
    expiresOn: "22 Jul 2031",
    status: "Verified",
    serial: "HIMT-FPFF-26-00682",
  },
];

const users = [
  {
    id: "user-001",
    name: "Aarav Mehta",
    email: "aarav.mehta@himt.edu.in",
    role: "Learner",
    group: "August 2026 · DNS",
    status: "Active",
    lastActivity: "4 min ago",
  },
  {
    id: "user-002",
    name: "Capt. Ananya Nair",
    email: "ananya.nair@himt.edu.in",
    role: "Faculty / Trainer",
    group: "Deck Department",
    status: "Active",
    lastActivity: "18 min ago",
  },
  {
    id: "user-003",
    name: "Rohan Kulkarni",
    email: "rohan.kulkarni@himt.edu.in",
    role: "Learner",
    group: "July 2026 · B.Tech",
    status: "Invited",
    lastActivity: "Never",
  },
];

const dashboard = {
  learner: {
    name: "Aarav Mehta",
    learnerId: "HIMT-26-0418",
    activeCourses: 3,
    completedCourses: 2,
    averageProgress: 68,
    pendingTasks: 4,
    attendance: 92,
    streak: 7,
  },
  courses,
  assignments,
  announcements,
  sessions,
  certificates,
};

const analytics = {
  activeLearners: 784,
  completionRate: 76,
  averageProgress: 68,
  pendingReviews: 18,
  weeklyActivity: [
    { label: "Mon", value: 48 },
    { label: "Tue", value: 62 },
    { label: "Wed", value: 58 },
    { label: "Thu", value: 74 },
    { label: "Fri", value: 69 },
    { label: "Sat", value: 42 },
    { label: "Sun", value: 35 },
  ],
  coursePerformance: [
    { label: "Bridge", value: 82 },
    { label: "Safety", value: 76 },
    { label: "Cargo", value: 64 },
    { label: "Fire", value: 88 },
  ],
};

router.get("/dashboard", (_req, res) => {
  res.json(GetDashboardResponse.parse(dashboard));
});

router.get("/courses", (req, res) => {
  const parsed = ListCoursesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search?.toLowerCase();
  const status = parsed.data.status?.toLowerCase();
  const filtered = courses.filter((course) => {
    const matchesSearch =
      !search ||
      course.name.toLowerCase().includes(search) ||
      course.code.toLowerCase().includes(search);
    const matchesStatus =
      !status || course.status.toLowerCase().includes(status);
    return matchesSearch && matchesStatus;
  });
  res.json(ListCoursesResponse.parse(filtered));
});

router.post("/courses", (req, res) => {
  const parsed = CreateCourseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const course = {
    id: `course-${Date.now()}`,
    code: parsed.data.code,
    name: parsed.data.name,
    category: parsed.data.category,
    language: parsed.data.language,
    status: "Draft",
    progress: 0,
    learners: 0,
    duration: parsed.data.duration,
    thumbnail: "new",
    nextActivity: null,
    accent: "ocean",
  };
  courses.push(course);
  res.status(201).json(CreateCourseResponse.parse(course));
});

router.get("/courses/:courseId", (req, res) => {
  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const course = courses.find((item) => item.id === params.data.courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  res.json(
    GetCourseResponse.parse({
      ...course,
      description:
        "Build confident, compliant bridge teams through applied navigation, regulations and watchkeeping practice.",
      objectives: [
        "Apply safe navigation principles in operational scenarios",
        "Coordinate bridge teams using clear communication",
        "Prepare and review a compliant passage plan",
      ],
      topics,
    }),
  );
});

router.get("/assignments", (req, res) => {
  const parsed = ListAssignmentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.status?.toLowerCase();
  const filtered = status
    ? assignments.filter((item) => item.status.toLowerCase().includes(status))
    : assignments;
  res.json(ListAssignmentsResponse.parse(filtered));
});

router.post("/assignments", (req, res) => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const assignment = {
    id: `assignment-${Date.now()}`,
    title: parsed.data.title,
    course: parsed.data.course,
    dueDate: parsed.data.dueDate,
    status: "Draft",
    submitted: false,
    assessor: parsed.data.assessor,
    priority: "normal",
  };
  assignments.push(assignment);
  res.status(201).json(CreateAssignmentResponse.parse(assignment));
});

router.get("/announcements", (_req, res) => {
  res.json(ListAnnouncementsResponse.parse(announcements));
});

router.get("/sessions", (_req, res) => {
  res.json(ListSessionsResponse.parse(sessions));
});

router.get("/certificates", (_req, res) => {
  res.json(ListCertificatesResponse.parse(certificates));
});

router.get("/analytics/overview", (_req, res) => {
  res.json(GetAnalyticsOverviewResponse.parse(analytics));
});

router.get("/users", (_req, res) => {
  res.json(ListUsersResponse.parse(users));
});

// ─── Curriculum seed data ────────────────────────────────────────────────────

const programmes = [
  {
    id: "prog-btme",
    name: "B.Tech Marine Engineering",
    code: "BTME",
    department: "Department of Marine Engineering",
    duration: "4 Years (8 Semesters)",
    totalCourses: 42,
    publishedCourses: 38,
    totalLearners: 312,
    status: "Active",
  },
  {
    id: "prog-dns",
    name: "Diploma in Nautical Science",
    code: "DNS",
    department: "Department of Navigation",
    duration: "3 Years (6 Semesters)",
    totalCourses: 28,
    publishedCourses: 26,
    totalLearners: 184,
    status: "Active",
  },
  {
    id: "prog-bsc-ms",
    name: "B.Sc. Maritime Studies",
    code: "BSc-MS",
    department: "Department of Maritime Studies",
    duration: "3 Years (6 Semesters)",
    totalCourses: 30,
    publishedCourses: 24,
    totalLearners: 98,
    status: "Active",
  },
];

const programmeCourseMap: Record<string, object[]> = {
  "prog-btme": [
    { id: "cur-mat101", name: "Mathematics I", code: "MAT-101", semester: 1, credits: 4, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 5, activitiesCount: 34 },
    { id: "cur-phy101", name: "Engineering Physics", code: "PHY-101", semester: 1, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 22 },
    { id: "cur-bms101", name: "Basic Marine Science", code: "BMS-101", semester: 1, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 18 },
    { id: "cur-che101", name: "Engineering Chemistry", code: "CHE-101", semester: 1, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 20 },
    { id: "cur-ws101", name: "Workshop Practice", code: "WS-101", semester: 1, credits: 2, type: "Lab", status: "Published", outcomesCount: 3, modulesCount: 2, activitiesCount: 12 },
    { id: "cur-mat201", name: "Mathematics II", code: "MAT-201", semester: 2, credits: 4, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 5, activitiesCount: 36 },
    { id: "cur-met201", name: "Marine Electrical Technology", code: "MET-201", semester: 2, credits: 3, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 24 },
    { id: "cur-che201", name: "Marine Chemistry", code: "CHE-201", semester: 2, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 20 },
    { id: "cur-ws201", name: "Engg. Workshop Practice", code: "WS-201", semester: 2, credits: 2, type: "Lab", status: "Published", outcomesCount: 3, modulesCount: 2, activitiesCount: 14 },
    { id: "cur-thd301", name: "Thermodynamics", code: "THD-301", semester: 3, credits: 4, type: "Core", status: "Published", outcomesCount: 6, modulesCount: 5, activitiesCount: 38 },
    { id: "cur-fm301", name: "Fluid Mechanics", code: "FM-301", semester: 3, credits: 4, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 28 },
    { id: "cur-sm301", name: "Strength of Materials", code: "SM-301", semester: 3, credits: 3, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 24 },
    { id: "cur-mps401", name: "Marine Propulsion Systems", code: "MPS-401", semester: 4, credits: 4, type: "Core", status: "Published", outcomesCount: 6, modulesCount: 5, activitiesCount: 36 },
    { id: "cur-sc401", name: "Ship Construction", code: "SC-401", semester: 4, credits: 3, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 26 },
    { id: "cur-ht401", name: "Heat Transfer", code: "HT-401", semester: 4, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 22 },
    { id: "cur-brm501", name: "Bridge Management & Regulations", code: "BRM-501", semester: 5, credits: 3, type: "Core", status: "Published", outcomesCount: 6, modulesCount: 4, activitiesCount: 28 },
    { id: "cur-pssr501", name: "Personal Safety & Social Responsibility", code: "PSSR-501", semester: 5, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 18 },
    { id: "cur-mep501", name: "Marine Environment Protection", code: "MEP-501", semester: 5, credits: 3, type: "Elective", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 22 },
    { id: "cur-met501", name: "Meteorology & Oceanography", code: "MET-501", semester: 5, credits: 3, type: "Core", status: "Draft", outcomesCount: 5, modulesCount: 4, activitiesCount: 20 },
    { id: "cur-fpff601", name: "Fire Prevention & Fire Fighting", code: "FPFF-601", semester: 6, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 16 },
    { id: "cur-sst601", name: "Ship Stability", code: "SST-601", semester: 6, credits: 4, type: "Core", status: "Published", outcomesCount: 6, modulesCount: 5, activitiesCount: 32 },
    { id: "cur-ml601", name: "Maritime Law", code: "ML-601", semester: 6, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 16 },
    { id: "cur-ers701", name: "Engine Room Simulator", code: "ERS-701", semester: 7, credits: 2, type: "Lab", status: "Draft", outcomesCount: 4, modulesCount: 2, activitiesCount: 12 },
    { id: "cur-smg701", name: "Ship Management", code: "SMG-701", semester: 7, credits: 3, type: "Elective", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 22 },
    { id: "cur-prj801", name: "Project Work", code: "PRJ-801", semester: 8, credits: 6, type: "Core", status: "Published", outcomesCount: 3, modulesCount: 3, activitiesCount: 10 },
    { id: "cur-int801", name: "Industry Internship", code: "INT-801", semester: 8, credits: 4, type: "Lab", status: "Published", outcomesCount: 3, modulesCount: 2, activitiesCount: 8 },
  ],
  "prog-dns": [
    { id: "dns-nav101", name: "Principles of Navigation", code: "NAV-101", semester: 1, credits: 4, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 28 },
    { id: "dns-met101", name: "Meteorology Basics", code: "MET-101", semester: 1, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 20 },
    { id: "dns-brm201", name: "Bridge Operations", code: "BOP-201", semester: 2, credits: 3, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 22 },
    { id: "dns-col201", name: "Collision Regulations", code: "COL-201", semester: 2, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 18 },
    { id: "dns-fps301", name: "Fire Prevention & Safety", code: "FPS-301", semester: 3, credits: 2, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 14 },
    { id: "dns-adv301", name: "Advanced Navigation", code: "ADV-301", semester: 3, credits: 4, type: "Core", status: "Draft", outcomesCount: 5, modulesCount: 4, activitiesCount: 24 },
  ],
  "prog-bsc-ms": [
    { id: "bsc-mgt101", name: "Maritime Management", code: "MGT-101", semester: 1, credits: 4, type: "Core", status: "Published", outcomesCount: 5, modulesCount: 4, activitiesCount: 26 },
    { id: "bsc-law101", name: "Introduction to Maritime Law", code: "LAW-101", semester: 1, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 3, activitiesCount: 18 },
    { id: "bsc-eco201", name: "Maritime Economics", code: "ECO-201", semester: 2, credits: 3, type: "Core", status: "Published", outcomesCount: 4, modulesCount: 4, activitiesCount: 20 },
    { id: "bsc-ops201", name: "Port & Terminal Operations", code: "PTO-201", semester: 2, credits: 3, type: "Core", status: "Draft", outcomesCount: 4, modulesCount: 3, activitiesCount: 16 },
  ],
};

const curriculumOutlines: Record<string, object> = {
  "cur-brm501": {
    id: "cur-brm501",
    name: "Bridge Management & Regulations",
    code: "BRM-501",
    credits: 3,
    semester: 5,
    type: "Core",
    description:
      "This course covers the principles of safe bridge operation including STCW watchkeeping standards, COLREG collision regulations, systematic passage planning, and emergency bridge procedures. Students develop competency aligned with STCW 2010 Manila Amendments for operational-level deck officers.",
    programmeId: "prog-btme",
    programmeName: "B.Tech Marine Engineering",
    outcomes: [
      {
        id: "co-brm-1",
        code: "CO1",
        description: "Describe the structure of bridge team management and the responsibilities of the officer of the watch under STCW",
        bloomsLevel: "Understand",
        poMapping: ["PO1", "PO2"],
      },
      {
        id: "co-brm-2",
        code: "CO2",
        description: "Apply COLREG rules to determine correct action in multi-vessel traffic situations at sea",
        bloomsLevel: "Apply",
        poMapping: ["PO1", "PO2", "PO5"],
      },
      {
        id: "co-brm-3",
        code: "CO3",
        description: "Analyze meteorological data and oceanographic charts to assess risk for a planned ocean passage",
        bloomsLevel: "Analyze",
        poMapping: ["PO1", "PO3", "PO4"],
      },
      {
        id: "co-brm-4",
        code: "CO4",
        description: "Evaluate emergency situations on bridge watch and prioritize response actions in accordance with company SMS",
        bloomsLevel: "Evaluate",
        poMapping: ["PO2", "PO5", "PO7"],
      },
      {
        id: "co-brm-5",
        code: "CO5",
        description: "Construct a complete passage plan for a deep-sea voyage using ECDIS, conventional charts, and publications",
        bloomsLevel: "Create",
        poMapping: ["PO1", "PO2", "PO3", "PO5"],
      },
      {
        id: "co-brm-6",
        code: "CO6",
        description: "Demonstrate OOW watchkeeping responsibilities including lookout, speed, and reporting in compliance with STCW",
        bloomsLevel: "Apply",
        poMapping: ["PO2", "PO5", "PO6"],
      },
    ],
    modules: [
      {
        id: "mod-brm-1",
        title: "Bridge Resource Management Foundations",
        order: 1,
        coIds: ["co-brm-1", "co-brm-6"],
        topics: [
          {
            id: "top-brm-1-1",
            title: "Bridge team structure and communication",
            duration: "1h 20m",
            type: "Lecture",
            activities: [
              { id: "act-brm-1-1-1", title: "Introduction to BRM — Video lecture", type: "Video", duration: "28 min", coIds: ["co-brm-1"] },
              { id: "act-brm-1-1-2", title: "Bridge hierarchy and responsibilities — Reading", type: "Reading", duration: "15 min", coIds: ["co-brm-1"] },
              { id: "act-brm-1-1-3", title: "Communication protocols on bridge — Knowledge check", type: "Quiz", duration: "10 questions", coIds: ["co-brm-1"] },
            ],
          },
          {
            id: "top-brm-1-2",
            title: "STCW watchkeeping standards and OOW duties",
            duration: "1h 45m",
            type: "Lecture",
            activities: [
              { id: "act-brm-1-2-1", title: "STCW 2010 Manila Amendments — Video lecture", type: "Video", duration: "35 min", coIds: ["co-brm-1", "co-brm-6"] },
              { id: "act-brm-1-2-2", title: "Watchkeeping regulations — Annotated document", type: "Reading", duration: "20 min", coIds: ["co-brm-6"] },
              { id: "act-brm-1-2-3", title: "OOW duties scenario exercise", type: "Activity", duration: "30 min", coIds: ["co-brm-6"] },
            ],
          },
        ],
      },
      {
        id: "mod-brm-2",
        title: "Collision Regulations (COLREG 1972)",
        order: 2,
        coIds: ["co-brm-2"],
        topics: [
          {
            id: "top-brm-2-1",
            title: "Rules of the road — Parts A, B, C and D",
            duration: "2h 00m",
            type: "Lecture",
            activities: [
              { id: "act-brm-2-1-1", title: "COLREG overview — Video lecture", type: "Video", duration: "40 min", coIds: ["co-brm-2"] },
              { id: "act-brm-2-1-2", title: "Animated rule demonstrations (Rules 1–19)", type: "Video", duration: "30 min", coIds: ["co-brm-2"] },
              { id: "act-brm-2-1-3", title: "Lights, shapes and sound signals — Rules 20–37", type: "Reading", duration: "20 min", coIds: ["co-brm-2"] },
            ],
          },
          {
            id: "top-brm-2-2",
            title: "Practical scenario-based application",
            duration: "1h 30m",
            type: "Tutorial",
            activities: [
              { id: "act-brm-2-2-1", title: "Multi-vessel encounter problems — Worksheet", type: "Activity", duration: "45 min", coIds: ["co-brm-2"] },
              { id: "act-brm-2-2-2", title: "COLREG rules assessment — MCQ test", type: "Quiz", duration: "20 questions", coIds: ["co-brm-2"] },
            ],
          },
        ],
      },
      {
        id: "mod-brm-3",
        title: "Passage Planning & Voyage Execution",
        order: 3,
        coIds: ["co-brm-3", "co-brm-5"],
        topics: [
          {
            id: "top-brm-3-1",
            title: "Passage planning methodology (APEM)",
            duration: "1h 30m",
            type: "Lecture",
            activities: [
              { id: "act-brm-3-1-1", title: "Appraise, Plan, Execute, Monitor — Video lecture", type: "Video", duration: "32 min", coIds: ["co-brm-5"] },
              { id: "act-brm-3-1-2", title: "ECDIS operation and chart corrections — Reading", type: "Reading", duration: "18 min", coIds: ["co-brm-5"] },
            ],
          },
          {
            id: "top-brm-3-2",
            title: "Meteorological and oceanographic analysis",
            duration: "1h 45m",
            type: "Lecture",
            activities: [
              { id: "act-brm-3-2-1", title: "Reading weather charts and routing — Video lecture", type: "Video", duration: "30 min", coIds: ["co-brm-3"] },
              { id: "act-brm-3-2-2", title: "Synoptic chart interpretation exercise", type: "Activity", duration: "30 min", coIds: ["co-brm-3"] },
              { id: "act-brm-3-2-3", title: "Passage plan submission — Assignment", type: "Assignment", duration: "2 hr", coIds: ["co-brm-3", "co-brm-5"] },
            ],
          },
        ],
      },
      {
        id: "mod-brm-4",
        title: "Emergency Bridge Procedures",
        order: 4,
        coIds: ["co-brm-4", "co-brm-5", "co-brm-6"],
        topics: [
          {
            id: "top-brm-4-1",
            title: "Man overboard and emergency steering",
            duration: "1h 20m",
            type: "Lecture",
            activities: [
              { id: "act-brm-4-1-1", title: "MOB procedures — Video lecture", type: "Video", duration: "25 min", coIds: ["co-brm-4"] },
              { id: "act-brm-4-1-2", title: "Emergency steering changeover — Animated guide", type: "Video", duration: "15 min", coIds: ["co-brm-4", "co-brm-6"] },
            ],
          },
          {
            id: "top-brm-4-2",
            title: "SAR operations and distress communication",
            duration: "1h 00m",
            type: "Tutorial",
            activities: [
              { id: "act-brm-4-2-1", title: "GMDSS distress procedures — Reading", type: "Reading", duration: "20 min", coIds: ["co-brm-4"] },
              { id: "act-brm-4-2-2", title: "Bridge emergency checklists — Activity", type: "Activity", duration: "20 min", coIds: ["co-brm-4", "co-brm-5"] },
              { id: "act-brm-4-2-3", title: "End-of-module assessment — Exam", type: "Quiz", duration: "30 questions", coIds: ["co-brm-1", "co-brm-2", "co-brm-3", "co-brm-4", "co-brm-5", "co-brm-6"] },
            ],
          },
        ],
      },
    ],
  },
  "cur-pssr501": {
    id: "cur-pssr501",
    name: "Personal Safety & Social Responsibility",
    code: "PSSR-501",
    credits: 2,
    semester: 5,
    type: "Core",
    description:
      "An STCW mandatory course covering personal survival techniques, fire prevention, elementary first aid, and seafarers' responsibilities aboard ship. On completion, students meet the STCW Basic Safety Training requirements under Regulation VI/1.",
    programmeId: "prog-btme",
    programmeName: "B.Tech Marine Engineering",
    outcomes: [
      { id: "co-pssr-1", code: "CO1", description: "Recall the correct actions for personal survival including donning a lifejacket and operating survival craft", bloomsLevel: "Remember", poMapping: ["PO1", "PO7"] },
      { id: "co-pssr-2", code: "CO2", description: "Explain procedures for fire prevention, fire-fighting and use of portable equipment aboard ship", bloomsLevel: "Understand", poMapping: ["PO1", "PO2", "PO7"] },
      { id: "co-pssr-3", code: "CO3", description: "Apply elementary first-aid techniques in response to injuries and medical situations at sea", bloomsLevel: "Apply", poMapping: ["PO1", "PO7"] },
      { id: "co-pssr-4", code: "CO4", description: "Demonstrate social responsibilities, fatigue awareness, and interpersonal conduct in a multicultural crew environment", bloomsLevel: "Apply", poMapping: ["PO7", "PO8", "PO9"] },
    ],
    modules: [
      {
        id: "mod-pssr-1",
        title: "Personal Survival Techniques",
        order: 1,
        coIds: ["co-pssr-1"],
        topics: [
          { id: "top-pssr-1-1", title: "Survival craft and rescue boat equipment", duration: "1h 00m", type: "Lecture", activities: [
            { id: "act-pssr-1-1-1", title: "Survival craft types — Video lecture", type: "Video", duration: "20 min", coIds: ["co-pssr-1"] },
            { id: "act-pssr-1-1-2", title: "Donning lifejacket — Practical demonstration", type: "Video", duration: "10 min", coIds: ["co-pssr-1"] },
          ]},
        ],
      },
      {
        id: "mod-pssr-2",
        title: "Fire Prevention & Fire Fighting",
        order: 2,
        coIds: ["co-pssr-2"],
        topics: [
          { id: "top-pssr-2-1", title: "Fire triangle and shipboard fire hazards", duration: "1h 15m", type: "Lecture", activities: [
            { id: "act-pssr-2-1-1", title: "Fire classes and extinguishers — Video", type: "Video", duration: "25 min", coIds: ["co-pssr-2"] },
            { id: "act-pssr-2-1-2", title: "Shipboard fire drill procedures — Reading", type: "Reading", duration: "15 min", coIds: ["co-pssr-2"] },
          ]},
        ],
      },
      {
        id: "mod-pssr-3",
        title: "First Aid & Social Responsibilities",
        order: 3,
        coIds: ["co-pssr-3", "co-pssr-4"],
        topics: [
          { id: "top-pssr-3-1", title: "Elementary first aid at sea", duration: "1h 00m", type: "Lecture", activities: [
            { id: "act-pssr-3-1-1", title: "Basic life support (BLS) — Video", type: "Video", duration: "20 min", coIds: ["co-pssr-3"] },
            { id: "act-pssr-3-1-2", title: "First-aid scenarios — Activity", type: "Activity", duration: "20 min", coIds: ["co-pssr-3"] },
          ]},
          { id: "top-pssr-3-2", title: "Crew responsibilities and conduct", duration: "45m", type: "Lecture", activities: [
            { id: "act-pssr-3-2-1", title: "ISM Code and SMS overview — Reading", type: "Reading", duration: "15 min", coIds: ["co-pssr-4"] },
            { id: "act-pssr-3-2-2", title: "PSSR final assessment — Quiz", type: "Quiz", duration: "20 questions", coIds: ["co-pssr-1", "co-pssr-2", "co-pssr-3", "co-pssr-4"] },
          ]},
        ],
      },
    ],
  },
};

router.get("/curriculum/programmes", (_req, res) => {
  res.json(ListProgrammesResponse.parse(programmes));
});

router.get("/curriculum/programmes/:programmeId/courses", (req, res) => {
  const { programmeId } = ListProgrammeCoursesParams.parse(req.params);
  const courses = programmeCourseMap[programmeId];
  if (!courses) {
    res.status(404).json({ error: "Programme not found" });
    return;
  }
  res.json(ListProgrammeCoursesResponse.parse(courses));
});

router.get("/curriculum/courses/:courseId/outline", (req, res) => {
  const { courseId } = GetCurriculumCourseOutlineParams.parse(req.params);
  const outline = curriculumOutlines[courseId];
  if (!outline) {
    res.status(404).json({ error: "Course curriculum not found" });
    return;
  }
  res.json(GetCurriculumCourseOutlineResponse.parse(outline));
});

router.post("/curriculum/courses/:courseId/outcomes", (req, res) => {
  const { courseId } = AddCourseOutcomeParams.parse(req.params);
  const body = AddCourseOutcomeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const outline = curriculumOutlines[courseId] as { outcomes?: object[] } | undefined;
  if (!outline) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  const outcomes = outline.outcomes ?? [];
  const newCO = AddCourseOutcomeResponse.parse({
    id: `co-${courseId}-${outcomes.length + 1}`,
    code: `CO${outcomes.length + 1}`,
    description: body.data.description,
    bloomsLevel: body.data.bloomsLevel,
    poMapping: body.data.poMapping,
  });
  outcomes.push(newCO);
  outline.outcomes = outcomes;
  res.status(201).json(newCO);
});

router.post("/users/import", (req, res) => {
  const parsed = ImportUsersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(
    ImportUsersResponse.parse({
      id: `import-${Date.now()}`,
      filename: parsed.data.filename,
      status: "Validated",
      total: parsed.data.rows,
      valid: Math.max(parsed.data.rows - 2, 0),
      warnings: Math.min(2, parsed.data.rows),
      failed: 0,
      progress: 100,
    }),
  );
});

export default router;