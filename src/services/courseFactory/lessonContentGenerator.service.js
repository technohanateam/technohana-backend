import { callClaude, extractJson } from "../aiAgent.service.js";
import { recordCourseFactorySpend, estimateCostUsd } from "./budgetGuard.service.js";
import { SLIDE_TYPES } from "../../models/courseFactory/academyLesson.model.js";

// Generates the full canonical lesson in one strict-JSON Claude call: sections,
// slides (concise, per spec §7 — narration carries the explanation, slides
// stay terse), quiz, exercise, lab, instructor notes, transcript. Validates
// every field before it's allowed to reach the database (spec §8): on
// invalid/incomplete JSON, the caller (orchestrator) retries once, then marks
// the step FAILED with the recorded error rather than persisting partial junk.
export async function generateLessonContent({ course, module, lesson }) {
  const system = `You are a senior instructional designer and technical writer producing a lesson for Technohana's AI Academy. Output ONLY a single JSON object, no prose, no markdown fences.

Critical rule: slide text and narration text must NEVER be near-duplicates. Slides are terse (a heading, a few words, a short bullet). Narration is what an instructor would actually say out loud to explain that slide — a full explanatory sentence or two, in a natural teaching voice.`;

  const prompt = `Write the full content for one lesson.

Course: ${course.title} (${course.level}, audience: ${course.audience})
Module: ${module.title}
Lesson: ${lesson.title}
Lesson description: ${lesson.description || ""}
Target duration: ${lesson.durationMinutes || 15} minutes

Lesson structure to follow (spec):
1. Learning objectives (2-4 measurable objectives)
2. Concept introduction
3. Visual explanation (diagram/architecture/process/example)
4. Practical example (real-world scenario)
5. Knowledge check (3-5 quiz questions, scenario-based where possible — never trivial recall)
6. Hands-on exercise where appropriate for this topic (omit if not appropriate — do not force one)
7. Summary
8. Next step

Slide count: choose the number the content actually needs (typically 7-15 for a 10-20 minute lesson). Do not pad.
Slide types available: ${SLIDE_TYPES.join(", ")}.

Quiz: write questions that test applying the concept to a scenario, not naming definitions. Each question must map to one of the learning objectives.

Return JSON exactly in this shape:
{
  "learningObjectives": ["..."],
  "sections": [ { "heading": "...", "body": "..." } ],
  "slides": [
    {
      "order": 1, "type": "title", "title": "...", "subtitle": "", "bullets": [],
      "body": "", "visualPrompt": "", "speakerNotes": "", "narration": "...", "estimatedSeconds": 40
    }
  ],
  "quiz": [
    {
      "question": "...", "type": "multiple-choice", "options": ["...","...","...","..."],
      "correctAnswer": 0, "explanation": "...", "difficulty": "medium", "learningObjective": "..."
    }
  ],
  "exercise": { "title": "...", "prompt": "...", "expectedOutcome": "..." },
  "lab": null,
  "instructorNotes": {
    "teachingObjectives": ["..."], "estimatedTeachingTime": "...",
    "talkingPoints": ["..."], "demos": ["..."], "discussionQuestions": ["..."], "commonMistakes": ["..."]
  },
  "transcript": "full narration script concatenated, in order, as one readable transcript"
}

If a hands-on exercise genuinely doesn't fit this topic, set "exercise" to null rather than inventing a fake one. Same for "lab" — only include it for hands-on technical lessons, and only reference real, generally available tools (e.g. Google Colab, GitHub, a browser sandbox) as an "externalResourceUrl" placeholder description, never invent infrastructure Technohana doesn't have.`;

  // A full lesson payload (8-15 slides + narration + quiz + exercise +
  // instructor notes + transcript, all in one JSON response) routinely runs
  // 7-8k output tokens — 8192 was measured truncating mid-JSON on a real
  // pilot run (stop_reason: "max_tokens"), which parseModelJson's repair
  // heuristics cannot recover from since the JSON is genuinely incomplete,
  // not just malformed. 16000 leaves real headroom above the observed need.
  const result = await callClaude({ system, prompt, maxTokens: 16000, tier: "standard" });
  const tokensIn = result.usage?.input_tokens || 0;
  const tokensOut = result.usage?.output_tokens || 0;
  await recordCourseFactorySpend(estimateCostUsd(result.model, tokensIn, tokensOut));

  const parsed = extractJson(result.text);
  validateLessonContent(parsed);
  return { content: parsed, model: result.model, usage: result.usage };
}

function validateLessonContent(content) {
  if (!content || typeof content !== "object") throw new Error("Lesson content response was not a JSON object");
  if (!Array.isArray(content.slides) || content.slides.length === 0) throw new Error("Lesson has no slides");
  if (content.slides.length > 25) throw new Error(`Lesson has ${content.slides.length} slides — likely over-generated`);

  content.slides.forEach((slide, i) => {
    if (!slide.type || !SLIDE_TYPES.includes(slide.type)) throw new Error(`Slide ${i + 1} has an invalid type: ${slide.type}`);
    if (typeof slide.order !== "number") slide.order = i + 1;
    if (slide.narration && slide.title && slide.narration.trim() === slide.title.trim()) {
      throw new Error(`Slide ${i + 1} narration is identical to its title — narration must explain, not repeat`);
    }
  });

  if (!Array.isArray(content.quiz) || content.quiz.length < 3) throw new Error("Lesson quiz needs at least 3 questions");
  content.quiz.forEach((q, i) => {
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Quiz question ${i + 1} is malformed`);
    }
    if (q.correctAnswer === undefined || q.correctAnswer === null) {
      throw new Error(`Quiz question ${i + 1} is missing correctAnswer`);
    }
  });

  if (!content.transcript || content.transcript.trim().length < 100) {
    throw new Error("Transcript is missing or too short");
  }
}
