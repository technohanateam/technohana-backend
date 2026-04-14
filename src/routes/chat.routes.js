// routes/chat.routes.js
// Hana — AI Course Advisor chat endpoints (ported from Python FastAPI service)

import express from "express";
import { createRequire } from "module";
import { OpenAI } from "openai";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import Enquiry from "../models/enquiry.model.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load course catalog once at startup
const courses = require(path.join(__dirname, "../data/courses.json"));

// In-memory session store: sessionId -> message[]
const sessions = new Map();

// --- Build system prompt from course catalog ---
function buildCatalogText(courses) {
  return courses
    .map((c) => {
      const learn = (c.whatWillYouLearn || []).slice(0, 5);
      const audience = c.targetAudience || [];
      const reqs = c.requirements || ["None"];
      return [
        `Course: ${c.courseTitle}`,
        `ID: ${c.id}`,
        `Category: ${c.category || "N/A"}`,
        `Duration: ${c.courseDays || "N/A"} | ${c.courseTime || "N/A"}`,
        `Price: ₹${c.price || "Contact us"}`,
        `Difficulty: ${c.difficulty || "N/A"}`,
        `Target Audience: ${audience.join(", ")}`,
        `You Will Learn: ${learn.join(", ")}`,
        `Prerequisites: ${reqs.join(", ")}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

const SYSTEM_PROMPT = `You are Hana, the friendly AI learning guide at Technohana — an AI training and certification company based in India.

Your job is to help website visitors:
1. Discover the right AI/ML course for their background and goals
2. Answer questions about pricing, duration, schedule, and prerequisites
3. Guide them toward enrolling when they're ready

COURSE CATALOG:
${buildCatalogText(courses)}

ENROLLMENT: Direct visitors to /enroll?courseId=<id> (e.g., /enroll?courseId=GENAI101)
WHATSAPP: +91 98219 67863
EMAIL: info@technohana.in

CONVERSATION GUIDELINES:
- Be warm, concise, and enthusiastic — you love AI and want to share that excitement
- Ask one focused question at a time to understand their background
- When recommending a course, mention the title, duration, price, and top 3 learning outcomes
- If someone seems ready to enroll, provide the enrollment link directly
- Stay focused on Technohana courses and AI/ML education — if asked about unrelated topics, gently redirect
- For corporate/team training, mention custom batch pricing and direct to WhatsApp
- For beginners, be encouraging and suggest beginner-friendly courses
- Keep replies under 120 words — be punchy, not verbose

RESPONSE FORMAT — always respond with ONLY valid JSON, no extra text:
{
  "reply": "Your conversational message here",
  "quick_replies": ["Short option 1", "Short option 2", "Short option 3"],
  "suggest_course": null
}

When suggesting a course, use:
{
  "reply": "Based on your background...",
  "quick_replies": ["Tell me more", "What's the price?", "I want to enroll"],
  "suggest_course": {
    "id": "COURSE_ID",
    "title": "Course Title",
    "price": "56000",
    "duration": "5 Days / 40 Hours",
    "category": "Generative AI",
    "slug": "course-slug-here"
  }
}

quick_replies must have 2-4 short options (max 5 words each) relevant to the current conversation state.
Never include markdown, code fences, or extra explanation — only the JSON object.`;

const GREETING = {
  reply: "Hi! I'm Hana, your AI learning guide at Technohana. What are you looking to learn today?",
  quick_replies: [
    "I'm a developer, show me AI courses",
    "I want AI certification",
    "My team needs training",
    "I'm new to AI",
  ],
  suggest_course: null,
};

function parseResponse(raw) {
  try {
    return JSON.parse(raw.trim());
  } catch (_) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
  }
  return {
    reply: raw.slice(0, 500) || "Something went wrong, please try again.",
    quick_replies: ["Try again", "Show me courses", "Contact support"],
    suggest_course: null,
  };
}

// GET /api/chat/greet?session_id=xxx
router.get("/api/chat/greet", (req, res) => {
  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: "session_id is required" });
  }
  return res.json(GREETING);
});

// POST /api/chat
router.post("/api/chat", async (req, res) => {
  const { session_id, message } = req.body || {};
  if (!session_id || !message?.trim()) {
    return res.status(400).json({ error: "session_id and message are required" });
  }

  const messages = sessions.get(session_id) || [];
  messages.push({ role: "user", content: message.trim() });

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1024,
      temperature: 0.7,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    });
    const raw = response.choices[0].message.content;
    const result = parseResponse(raw);
    messages.push({ role: "assistant", content: raw });
    sessions.set(session_id, messages);
    return res.json(result);
  } catch (err) {
    console.error("Chat error:", err.message);
    return res.json({
      reply: "I'm having a moment — please try again shortly! You can also reach us on WhatsApp at +91 98219 67863.",
      quick_replies: ["Try again", "Browse courses", "WhatsApp us"],
      suggest_course: null,
    });
  }
});

// DELETE /api/chat/:session_id
router.delete("/api/chat/:session_id", (req, res) => {
  sessions.delete(req.params.session_id);
  return res.json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// Skills Gap API
// ---------------------------------------------------------------------------

function buildSkillsGapCatalog(courses) {
  return courses
    .map((c) => {
      const audience = (c.targetAudience || [])[0] || "";
      const outcomes = (c.whatWillYouLearn || []).slice(0, 2).join("; ");
      const prices = c.prices || {};
      return (
        `${c.courseTitle} | ID:${c.id} | ${c.category || "N/A"} | ` +
        `${c.courseDays || "?"} ${c.courseTime || "?"} | ` +
        `INR:${prices.inr || c.price || "?"} | USD:${prices.usd || "?"} | AED:${prices.aed || "?"} | ` +
        `${c.difficulty || "N/A"} | ${audience} | ${outcomes}`
      );
    })
    .join("\n");
}

const SKILLS_GAP_SYSTEM = `You are a career advisor AI for Technohana, an AI and tech training company.

Your job: given a user's CURRENT ROLE and TARGET ROLE, identify their skill gaps and recommend the best matching courses from the Technohana catalog.

COURSE CATALOG (format: Title | ID | Category | Duration | INR Price | USD Price | AED Price | Level | Audience | Key outcomes):
${buildSkillsGapCatalog(courses)}

RULES:
- Identify 3–6 specific, concrete skill gaps between the current role and target role
- Recommend 2–4 courses from the catalog that directly address those gaps — ONLY use courses from the catalog above
- For each recommended course, explain which gap(s) it addresses
- Calculate total cost (INR, USD, AED) and a realistic timeline in weeks
- Include group savings for team sizes 5 and 10+ (15% and 35% discounts)
- Keep the tone encouraging and direct

RESPONSE FORMAT — always respond with ONLY valid JSON, no extra text:
{
  "summary": "One encouraging sentence about this career transition",
  "skillGaps": ["Specific skill gap 1", "Specific skill gap 2", "Specific skill gap 3"],
  "recommendedCourses": [
    {
      "id": "COURSE_ID",
      "title": "Course Title",
      "category": "Category",
      "duration": "X Days / Y Hours",
      "prices": { "inr": 12000, "usd": 150, "aed": 550 },
      "difficulty": "Beginner/Intermediate/Advanced",
      "gapsAddressed": ["Gap 1", "Gap 3"],
      "slug": "course-slug"
    }
  ],
  "timeline": { "totalWeeks": 24, "description": "Brief timeline explanation" },
  "totalCost": { "inr": 45000, "usd": 560, "aed": 2050 },
  "groupSavings": {
    "team5": { "inr": 38250, "usd": 476, "aed": 1742, "discountPercent": 15 },
    "team10": { "inr": 29250, "usd": 364, "aed": 1332, "discountPercent": 35 }
  },
  "nextStep": "Enroll in [first course title] to get started."
}

Never include markdown, code fences, or extra text — ONLY the JSON object.`;

function parseJsonResponse(raw) {
  try { return JSON.parse(raw.trim()); } catch (_) {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

// POST /api/skills-gap
router.post("/api/skills-gap", async (req, res) => {
  const { current_role, target_role, currency = "inr" } = req.body || {};
  if (!current_role?.trim() || !target_role?.trim()) {
    return res.status(422).json({ error: "current_role and target_role are required." });
  }

  const userMessage =
    `Current role: ${current_role.trim()}\nTarget role: ${target_role.trim()}\nPreferred currency: ${currency.toUpperCase()}\n\nPlease identify my skill gaps and recommend courses.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2048,
      temperature: 0.3,
      messages: [
        { role: "system", content: SKILLS_GAP_SYSTEM },
        { role: "user", content: userMessage },
      ],
    });
    const result = parseJsonResponse(response.choices[0].message.content);
    if (!result) throw new Error("parse_failed");
    // Save anonymous lead — roles only, no email required
    new Enquiry({
      name: "Anonymous",
      email: `skillsgap+${Date.now()}@anonymous.technohana.in`,
      enquiryType: "Skills Gap",
      description: `${current_role.trim()} → ${target_role.trim()}`,
      source: "skills_gap_tool",
    }).save().catch(() => {});
    return res.json(result);
  } catch (err) {
    console.error("Skills gap error:", err.message);
    return res.json({
      summary: "Unable to analyze right now. Please try again shortly.",
      skillGaps: [],
      recommendedCourses: [],
      timeline: { totalWeeks: 0, description: "" },
      totalCost: { inr: 0, usd: 0, aed: 0 },
      groupSavings: {},
      nextStep: "Contact us on WhatsApp at +91 98219 67863 for a personalized recommendation.",
    });
  }
});

// POST /api/skills-gap/save-lead
router.post("/api/skills-gap/save-lead", async (req, res) => {
  const { name, email, current_role, target_role } = req.body || {};
  if (!email) return res.status(422).json({ error: "email is required." });

  try {
    await new Enquiry({
      name: name || "Unknown",
      email,
      enquiryType: "Skills Gap",
      description: `Skills gap analysis: ${current_role || "?"} → ${target_role || "?"}`,
      source: "skills_gap_tool",
    }).save();
  } catch (err) {
    console.error("save-lead error:", err.message);
  }
  return res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Interview Coach API
// ---------------------------------------------------------------------------

const interviewSessions = new Map();

function buildQuestionGenPrompt(role, courseContext, mode, numQuestions) {
  const modeInstruction = {
    technical: "All questions should be technical/domain-specific, testing knowledge and problem-solving.",
    behavioural: "All questions should be behavioural (STAR-format), testing soft skills, teamwork, and leadership.",
    mixed: `Mix: first ${Math.floor(numQuestions / 2)} technical, remaining behavioural.`,
  }[mode] || "Mix technical and behavioural questions.";

  return `You are an expert interviewer preparing a candidate for a ${role} role.
${courseContext}

Generate exactly ${numQuestions} interview questions.
${modeInstruction}

Questions should be realistic, commonly asked at top tech companies, and progressively more challenging.

Return ONLY a JSON array, no other text:
[
  {
    "id": 1,
    "type": "technical",
    "question": "Question text here",
    "expectedTopics": ["topic1", "topic2"],
    "difficulty": "easy|medium|hard"
  }
]`;
}

function buildEvaluatorPrompt(role, question, expectedTopics, answer) {
  return `You are a senior interviewer evaluating a candidate for a ${role} role.

Question: ${question}
Expected topics: ${expectedTopics.join(", ") || "general concepts"}
Candidate's answer: ${answer}

Return ONLY valid JSON:
{
  "score": 7,
  "maxScore": 10,
  "verdict": "Good|Strong|Needs Improvement|Excellent",
  "strengths": ["What they did well"],
  "improvements": ["What to improve"],
  "modelAnswer": "A concise ideal answer in 2-4 sentences",
  "followUpQuestion": null
}`;
}

function buildSummaryPrompt(role, qaPairs) {
  const transcript = qaPairs
    .map((p, i) => `Q${i + 1}: ${p.question}\nA: ${p.answer}\nScore: ${p.score}/10 — ${p.verdict}`)
    .join("\n\n");

  return `You are a career coach summarising a mock interview for a ${role} candidate.

Interview transcript:
${transcript}

Return ONLY valid JSON:
{
  "overallScore": 72,
  "grade": "B+",
  "verdict": "Strong candidate with areas to sharpen",
  "topStrengths": ["Strength 1", "Strength 2", "Strength 3"],
  "areasToImprove": ["Area 1", "Area 2"],
  "actionPlan": ["Action 1", "Action 2"],
  "readinessLevel": "Ready|Almost Ready|Needs More Prep",
  "encouragement": "A warm closing message"
}`;
}

function parseLlmList(raw) {
  try { return JSON.parse(raw.trim()); } catch (_) {}
  const m = raw.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return [];
}

function fallbackQuestions(role, mode, num) {
  const technical = [
    { id: 1, type: "technical", difficulty: "medium", expectedTopics: ["fundamentals"], question: `Explain the core concepts you'd apply as a ${role}.` },
    { id: 2, type: "technical", difficulty: "medium", expectedTopics: ["problem-solving"], question: "Walk me through how you'd debug a production issue in your domain." },
    { id: 3, type: "technical", difficulty: "hard", expectedTopics: ["architecture"], question: "How would you design a scalable system for a high-traffic use case?" },
  ];
  const behavioural = [
    { id: 4, type: "behavioural", difficulty: "easy", expectedTopics: ["teamwork"], question: "Tell me about a time you worked through a difficult team conflict." },
    { id: 5, type: "behavioural", difficulty: "medium", expectedTopics: ["leadership"], question: "Describe a project where you had to take ownership with minimal guidance." },
  ];
  const pool = mode === "technical" ? technical : mode === "behavioural" ? behavioural : [...technical, ...behavioural];
  return pool.slice(0, num);
}

async function llmOneShot(prompt) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2048,
    temperature: 0.5,
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0].message.content;
}

// POST /api/interview/start
router.post("/api/interview/start", async (req, res) => {
  const { role, course_title, mode = "mixed", num_questions = 5 } = req.body || {};
  if (!role?.trim()) return res.status(422).json({ error: "role is required." });

  const course = courses.find(
    (c) => c.courseTitle?.toLowerCase() === course_title?.toLowerCase() ||
           c.courseTitle?.toLowerCase().includes(course_title?.toLowerCase() || "____")
  );
  const courseContext = course
    ? `The candidate completed '${course.courseTitle}' covering: ${(course.whatWillYouLearn || []).slice(0, 4).join(", ")}`
    : "";

  let questions;
  try {
    const raw = await llmOneShot(buildQuestionGenPrompt(role.trim(), courseContext, mode, num_questions));
    questions = parseLlmList(raw);
    if (!questions.length) throw new Error("empty");
  } catch (_) {
    questions = fallbackQuestions(role.trim(), mode, num_questions);
  }

  const session_id = randomUUID();
  interviewSessions.set(session_id, {
    role: role.trim(),
    course_title,
    mode,
    questions,
    answers: [],
    evaluations: [],
  });

  return res.json({
    session_id,
    total_questions: questions.length,
    current_question_index: 0,
    question: questions[0],
    role: role.trim(),
    mode,
  });
});

// POST /api/interview/answer
router.post("/api/interview/answer", async (req, res) => {
  const { session_id, answer } = req.body || {};
  const session = interviewSessions.get(session_id);
  if (!session) return res.status(404).json({ error: "Session not found. Please start a new interview." });

  const { questions, answers } = session;
  const currentIdx = answers.length;
  if (currentIdx >= questions.length) {
    return res.json({ error: "Interview already complete. Call /api/interview/feedback for your summary." });
  }

  const currentQ = questions[currentIdx];
  session.answers.push(answer?.trim() || "");

  let evaluation;
  try {
    const raw = await llmOneShot(buildEvaluatorPrompt(session.role, currentQ.question, currentQ.expectedTopics || [], answer));
    evaluation = parseJsonResponse(raw) || {};
  } catch (_) {
    evaluation = { score: 6, maxScore: 10, verdict: "Good", strengths: ["Clear answer"], improvements: ["Add specific examples"], modelAnswer: "Focus on concrete examples.", followUpQuestion: null };
  }
  evaluation.question = currentQ.question;
  session.evaluations.push(evaluation);

  const nextIdx = currentIdx + 1;
  const is_complete = nextIdx >= questions.length;
  const result = { evaluation, is_complete, current_question_index: currentIdx, total_questions: questions.length };
  if (!is_complete) {
    result.next_question = questions[nextIdx];
    result.next_question_index = nextIdx;
  }
  return res.json(result);
});

// POST /api/interview/feedback
router.post("/api/interview/feedback", async (req, res) => {
  const { session_id } = req.body || {};
  const session = interviewSessions.get(session_id);
  if (!session) return res.status(404).json({ error: "Session not found." });

  const { questions, answers, evaluations, role } = session;
  if (!answers.length) return res.status(400).json({ error: "No answers recorded yet." });

  const qaPairs = answers.map((answer, i) => ({
    question: questions[i]?.question || "",
    answer,
    score: evaluations[i]?.score || 0,
    verdict: evaluations[i]?.verdict || "",
  }));

  let summary;
  try {
    const raw = await llmOneShot(buildSummaryPrompt(role, qaPairs));
    summary = parseJsonResponse(raw) || {};
  } catch (_) {
    const avg = evaluations.reduce((s, e) => s + (e.score || 0), 0) / Math.max(evaluations.length, 1);
    summary = { overallScore: Math.round(avg * 10), grade: "B", verdict: "Good effort", topStrengths: ["Completed the interview"], areasToImprove: ["Practice more examples"], actionPlan: ["Review model answers"], readinessLevel: "Almost Ready", encouragement: "Keep practising — you're on the right track!" };
  }

  summary.qa_pairs = qaPairs;
  summary.role = role;
  summary.total_questions = questions.length;
  summary.answered = answers.length;
  return res.json(summary);
});

// ---------------------------------------------------------------------------
// Roadmap API
// ---------------------------------------------------------------------------

function findCourse(courseId, courseTitle) {
  if (courseId) {
    const c = courses.find((c) => c.id?.toUpperCase() === courseId.toUpperCase());
    if (c) return c;
  }
  if (courseTitle) {
    const tl = courseTitle.toLowerCase();
    return (
      courses.find((c) => c.courseTitle?.toLowerCase() === tl) ||
      courses.find((c) => c.courseTitle?.toLowerCase().includes(tl)) ||
      null
    );
  }
  return null;
}

function buildCourseContext(course) {
  const modules = (course.modules || []).slice(0, 10)
    .map((m) => `  - ${m.moduleTitle || "Module"}: ${(m.content || []).slice(0, 3).join(", ")}`)
    .join("\n");
  const outcomes = (course.whatWillYouLearn || []).slice(0, 5)
    .map((o) => `  - ${o}`).join("\n");
  return `Course: ${course.courseTitle}\nDuration: ${course.courseDays || "?"} / ${course.courseTime || "?"}\nLevel: ${course.difficulty || "?"}\nModules:\n${modules}\nLearning outcomes:\n${outcomes}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function roadmapFallback(courseTitle, learnerName, startDate) {
  return {
    courseTitle, learnerName, startDate,
    phases: [
      { phase: 1, label: "Days 1–30: Foundations", targetDate: addDays(startDate, 30), milestones: [{ week: 1, title: "Core Concepts", dateRange: `${fmtDate(startDate)} – ${fmtDate(addDays(startDate, 6))}`, tasks: ["Complete Module 1", "Set up your learning environment", "Take the intro assessment"], deliverable: "Complete first module and pass entry quiz" }] },
      { phase: 2, label: "Days 31–60: Hands-on Labs", targetDate: addDays(startDate, 60), milestones: [{ week: 5, title: "Applied Practice", dateRange: `${fmtDate(addDays(startDate, 30))} – ${fmtDate(addDays(startDate, 36))}`, tasks: ["Complete lab exercises", "Build a mini-project", "Peer review session"], deliverable: "Submit hands-on lab project" }] },
      { phase: 3, label: "Days 61–90: Capstone & Certification", targetDate: addDays(startDate, 90), milestones: [{ week: 9, title: "Capstone & Exam Prep", dateRange: `${fmtDate(addDays(startDate, 60))} – ${fmtDate(addDays(startDate, 66))}`, tasks: ["Complete capstone project", "Take 2 practice exams", "Review weak areas"], deliverable: "Submit capstone + schedule certification exam" }] },
    ],
    careerNextSteps: ["Update your LinkedIn headline with this certification", "Join the Technohana alumni community", "Apply to target roles using your new skills"],
    examDate: addDays(startDate, 90),
    certificationTarget: null,
  };
}

// POST /api/roadmap/generate
router.post("/api/roadmap/generate", async (req, res) => {
  const { course_id, course_title, learner_name = "Learner", start_date } = req.body || {};
  if (!course_id && !course_title) return res.status(422).json({ error: "course_id or course_title is required." });

  const startDate = start_date || new Date().toISOString().slice(0, 10);
  const course = findCourse(course_id, course_title);
  if (!course) return res.json(roadmapFallback(course_title || course_id || "Your Course", learner_name, startDate));

  const courseContext = buildCourseContext(course);
  const systemPrompt = `You are a learning coach at Technohana. Generate a practical 30-60-90 day roadmap for the learner below.

LEARNER: ${learner_name}
START DATE: ${startDate}
${courseContext}

RULES:
- Split learning into 3 phases: Days 1-30 (Foundations), Days 31-60 (Hands-on), Days 61-90 (Capstone & Certification)
- Each phase has 2-3 weekly milestones with title, 2-4 tasks, and one deliverable
- Calculate actual calendar dates from the start date
- Use actual module names from the course
- Post-90 career steps: LinkedIn update, job search tip, alumni community

RESPONSE FORMAT — valid JSON only, no extra text:
{"courseTitle":"...","learnerName":"...","startDate":"YYYY-MM-DD","phases":[{"phase":1,"label":"Days 1–30: Foundations","targetDate":"YYYY-MM-DD","milestones":[{"week":1,"title":"...","dateRange":"...","tasks":["..."],"deliverable":"..."}]}],"careerNextSteps":["..."],"examDate":"YYYY-MM-DD","certificationTarget":null}`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: "gpt-4o", max_tokens: 2048, temperature: 0.4,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Generate the 30-60-90 day roadmap now." }],
    });
    const result = parseJsonResponse(response.choices[0].message.content);
    if (!result) throw new Error("parse_failed");
    result.courseId = course.id;
    result.courseSlug = course.courseSlug;
    return res.json(result);
  } catch (err) {
    console.error("Roadmap error:", err.message);
    return res.json({ ...roadmapFallback(course.courseTitle, learner_name, startDate), courseId: course.id, courseSlug: course.courseSlug });
  }
});

// ---------------------------------------------------------------------------
// LinkedIn Optimizer API
// ---------------------------------------------------------------------------

// POST /api/linkedin/optimize
router.post("/api/linkedin/optimize", async (req, res) => {
  const { course_id, course_title, learner_name = "Professional", current_role = "", current_headline = "" } = req.body || {};
  if (!course_id && !course_title) return res.status(422).json({ error: "course_id or course_title is required." });

  const course = findCourse(course_id, course_title);
  const title = course?.courseTitle || course_title || course_id || "Your Course";

  if (!course) {
    return res.json({
      courseTitle: title,
      headline: `${learner_name}${current_role ? ` | ${current_role}` : ""} | ${title} Certified | AI & Tech Professional`,
      aboutSection: `I recently completed the ${title} course, deepening my expertise in AI and technology. I'm passionate about continuous learning and applying new skills to solve real-world problems.`,
      skillsToAdd: ["Artificial Intelligence", "Machine Learning", "Data Science", "Cloud Computing", "Python", "Deep Learning"],
      linkedInPost: `Excited to share that I've just completed the ${title} certification!\n\nThe hands-on labs made all the difference. Looking forward to applying these skills.\n\n#AI #MachineLearning #Certification #CareerGrowth #Upskilling`,
      hashtags: ["#AI", "#MachineLearning", "#Certification", "#CareerGrowth", "#Upskilling"],
    });
  }

  const outcomes = (course.whatWillYouLearn || []).slice(0, 5).map((o) => `  - ${o}`).join("\n");
  const systemPrompt = `You are a LinkedIn career coach at Technohana.

A learner just completed this course:
Course: ${course.courseTitle}
Category: ${course.category}
Difficulty: ${course.difficulty}
Key outcomes:\n${outcomes}

Learner details:
Name: ${learner_name}
Current role/headline: ${current_role || current_headline || "Professional"}

Generate 4 things:
1. A LinkedIn HEADLINE (max 220 chars) incorporating their current role + this certification
2. An ABOUT SECTION rewrite (200-250 words) — professional, first-person
3. A SKILLS list (8-12 specific skills from the course)
4. A LINKEDIN POST (150-200 words) announcing the certification with 5-7 hashtags

RULES:
- Headline must be punchy and keyword-rich
- About section should sound human, not AI-generated
- Skills must be specific (e.g. "AWS EC2" not "Cloud Computing")
- Do NOT mention Technohana in the post

RESPONSE FORMAT — valid JSON only, no extra text:
{"headline":"...","aboutSection":"...","skillsToAdd":["..."],"linkedInPost":"...","hashtags":["#Tag1"]}`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: "gpt-4o", max_tokens: 2048, temperature: 0.6,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Generate the LinkedIn optimization now." }],
    });
    const result = parseJsonResponse(response.choices[0].message.content);
    if (!result) throw new Error("parse_failed");
    result.courseTitle = course.courseTitle;
    result.courseId = course.id;
    return res.json(result);
  } catch (err) {
    console.error("LinkedIn optimize error:", err.message);
    return res.json({
      courseTitle: course.courseTitle, courseId: course.id,
      headline: `${learner_name}${current_role ? ` | ${current_role}` : ""} | ${course.courseTitle} Certified`,
      aboutSection: `I recently completed the ${course.courseTitle} course, deepening my expertise in AI and technology.`,
      skillsToAdd: ["Artificial Intelligence", "Machine Learning", "Python", "Data Science", "Cloud Computing"],
      linkedInPost: `Just completed the ${course.courseTitle} certification! 🎓\n\n#AI #MachineLearning #Certification #CareerGrowth #Upskilling`,
      hashtags: ["#AI", "#MachineLearning", "#Certification", "#CareerGrowth", "#Upskilling"],
    });
  }
});

// ---------------------------------------------------------------------------
// Content Calendar API
// ---------------------------------------------------------------------------

const SCHEDULE_DAYS = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28];
const POST_TYPES = ["announcement", "lesson", "tip", "story", "industry", "milestone", "resource", "question", "before_after", "cta"];
const BEST_TIMES = ["09:00", "12:00", "09:00", "17:00", "09:00", "12:00", "09:00", "12:00", "17:00", "09:00"];

function fillPostDates(posts, startDate) {
  return posts.map((post, i) => {
    const day = SCHEDULE_DAYS[i] ?? (i * 3 + 1);
    if (!post.scheduledDate) post.scheduledDate = addDays(startDate, day - 1);
    if (!post.scheduledDay) post.scheduledDay = day;
    return post;
  });
}

function contentCalendarFallback(courseTitle, learnerName, startDate) {
  return {
    courseTitle, learnerName, startDate, courseId: null, courseSlug: null,
    posts: POST_TYPES.map((type, i) => ({
      id: i + 1, type, scheduledDay: SCHEDULE_DAYS[i],
      scheduledDate: addDays(startDate, SCHEDULE_DAYS[i] - 1),
      bestTime: BEST_TIMES[i],
      hook: `[Draft] ${type.replace(/_/g, " ")} post about ${courseTitle}`,
      content: `Write your ${type.replace(/_/g, " ")} post here about completing ${courseTitle}.\n\n#Learning #AI #TechSkills #CareerGrowth #Upskilling`,
      hashtags: ["#Learning", "#AI", "#TechSkills", "#CareerGrowth", "#Upskilling"],
      engagementTip: "Personalise this post with a specific story or example from your experience.",
    })),
  };
}

// POST /api/content-calendar/generate
router.post("/api/content-calendar/generate", async (req, res) => {
  const { course_id, course_title, learner_name = "Professional", current_role = "", start_date } = req.body || {};
  if (!course_id && !course_title) return res.status(422).json({ error: "course_id or course_title is required." });

  const startDate = start_date || new Date().toISOString().slice(0, 10);
  const course = findCourse(course_id, course_title);
  if (!course) return res.json(contentCalendarFallback(course_title || course_id || "Your Course", learner_name, startDate));

  const outcomes = (course.whatWillYouLearn || []).slice(0, 5).map((o) => `  - ${o}`).join("\n");
  const systemPrompt = `You are a LinkedIn content strategist helping a professional build their personal brand after completing a tech course.

Learner: ${learner_name}
Current role: ${current_role || "Tech Professional"}
Course completed: ${course.courseTitle}
Category: ${course.category}
Key skills learned:\n${outcomes}
Campaign start date: ${startDate}

Generate exactly 10 LinkedIn posts — one of each type: ${POST_TYPES.join(", ")}.

Each post must:
- Be 120-200 words
- Sound authentic, first-person
- Include 4-6 relevant hashtags
- Have a clear hook in the first line
- Schedule on days: ${SCHEDULE_DAYS.join(", ")}

Return ONLY valid JSON:
{"courseTitle":"...","learnerName":"...","startDate":"...","posts":[{"id":1,"type":"announcement","scheduledDay":1,"scheduledDate":"YYYY-MM-DD","bestTime":"09:00","hook":"...","content":"...","hashtags":["#Tag1"],"engagementTip":"..."}]}`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: "gpt-4o", max_tokens: 4096, temperature: 0.7,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Generate the 30-day LinkedIn content calendar now." }],
    });
    const result = parseJsonResponse(response.choices[0].message.content);
    if (!result) throw new Error("parse_failed");
    result.courseId = course.id;
    result.courseSlug = course.courseSlug;
    result.posts = fillPostDates(result.posts || [], startDate);
    return res.json(result);
  } catch (err) {
    console.error("Content calendar error:", err.message);
    return res.json({ ...contentCalendarFallback(course.courseTitle, learner_name, startDate), courseId: course.id, courseSlug: course.courseSlug });
  }
});

// ---------------------------------------------------------------------------
// Parse Course PDF API
// ---------------------------------------------------------------------------

import multer from "multer";
import { PDFParse } from "pdf-parse";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/parse-course-pdf
router.post("/api/parse-course-pdf", upload.single("file"), async (req, res) => {
  if (!req.file || !req.file.originalname.toLowerCase().endsWith(".pdf")) {
    return res.status(400).json({ error: "Only PDF files are accepted" });
  }

  let text;
  try {
    const parser = new PDFParse({ data: req.file.buffer });
    const parsed = await parser.getText();
    text = parsed.text?.trim();
  } catch (err) {
    return res.status(422).json({ error: "Could not extract text from PDF" });
  }

  if (!text) return res.status(422).json({ error: "Could not extract text from PDF" });

  const prompt = `You are extracting structured course data from a training/course syllabus PDF.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields:
- id: suggested course code like "PYML101"
- courseTitle: full course name
- category: one of "Artificial Intelligence", "Data Science", "Cloud Computing", "Cybersecurity", "DevOps", "Programming", "Project Management", "Generative AI", or best fit
- difficulty: "Beginner", "Intermediate", or "Advanced"
- instructor: instructor name if mentioned, else ""
- courseDays: duration like "05 Days" or ""
- courseTime: total hours like "40 Hours" or ""
- courseModules: number of modules like "07 Modules" or ""
- overview: 2-3 sentence course description
- courseObjective: 2-3 sentences on what the course aims to achieve
- courseOutcomes: 2-3 sentences on what learners will achieve
- labs: description of hands-on labs, or ""
- prerequisites: array of prerequisite strings
- whatWillYouLearn: array of 5-10 key learning points
- requirements: array of technical requirements
- targetAudience: array of 3-5 intended learner types
- modules: array of objects with "moduleTitle" and "content" (array of topic strings)

Syllabus text:
${text.slice(0, 12000)}`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: "gpt-4o", max_tokens: 4096, temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    let raw = response.choices[0].message.content.trim();
    if (raw.startsWith("```")) { raw = raw.split("```")[1]; if (raw.startsWith("json")) raw = raw.slice(4); }
    const course_data = JSON.parse(raw);
    return res.json({ course: course_data });
  } catch (err) {
    console.error("PDF parse error:", err.message);
    return res.status(500).json({ error: "AI returned invalid JSON or call failed" });
  }
});

export default router;
