// routes/chat.routes.js
// Hana — AI Course Advisor chat endpoints (ported from Python FastAPI service)

import express from "express";
import { createRequire } from "module";
import { OpenAI } from "openai";
import path from "path";
import { fileURLToPath } from "url";

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

export default router;
