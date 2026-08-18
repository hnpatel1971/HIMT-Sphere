import { Router, type IRouter } from "express";
import {
  CreateAssignmentBody,
  CreateAssignmentResponse,
  CreateCourseBody,
  CreateCourseResponse,
  GetAnalyticsOverviewResponse,
  GetCourseParams,
  GetCourseResponse,
  GetDashboardResponse,
  ImportUsersBody,
  ImportUsersResponse,
  ListAnnouncementsResponse,
  ListAssignmentsQueryParams,
  ListAssignmentsResponse,
  ListCertificatesResponse,
  ListCoursesQueryParams,
  ListCoursesResponse,
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