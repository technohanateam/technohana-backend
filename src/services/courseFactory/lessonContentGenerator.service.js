import { callClaude, extractJson } from "../aiAgent.service.js";
import { recordCourseFactorySpend, estimateCostUsd } from "./budgetGuard.service.js";
import { SLIDE_TYPES, DIAGRAM_TYPES } from "../../models/courseFactory/academyLesson.model.js";
import { getOrCreateCourseFactorySettings } from "../../models/courseFactory/courseFactorySettings.model.js";

// Thrown when Claude's response was cut off by the token limit rather than
// finishing naturally — the JSON is genuinely incomplete, not just malformed,
// so parseModelJson's repair heuristics are never even attempted (they can't
// recover missing content, only fix formatting). The orchestrator must not
// persist partial content or generate downstream assets (PPTX/audio) from it.
export class LessonContentTruncatedError extends Error {
  constructor(maxTokens) {
    super(`Lesson content generation was truncated at maxTokens=${maxTokens} (stop_reason: max_tokens) — response is incomplete, not malformed. Raise CourseFactorySettings.lessonContentMaxTokens and retry.`);
    this.name = "LessonContentTruncatedError";
    this.maxTokens = maxTokens;
  }
}

// Generates the full canonical lesson in one strict-JSON Claude call: sections,
// slides (concise, per spec §7 — narration carries the explanation, slides
// stay terse), quiz, exercise, lab, instructor notes, transcript. Validates
// every field before it's allowed to reach the database (spec §8): on
// invalid/incomplete JSON, the caller (orchestrator) retries once, then marks
// the step FAILED with the recorded error rather than persisting partial junk.
export async function generateLessonContent({ course, module, lesson }) {
  const system = `You are a senior instructional designer and technical writer producing a lesson for Technohana's AI Academy. Output ONLY a single JSON object, no prose, no markdown fences.

Critical rule: slide text and narration text must NEVER be near-duplicates. Slides are terse (a heading, a few words, a short bullet). Narration is what an instructor would actually say out loud to explain that slide — a full explanatory sentence or two, in a natural teaching voice.

Narration voice rules (this is what most separates a professional course from an AI-generated one):
- Explain the idea, don't describe the slide. Never write "On this slide, we..." or "Here we can see..." or "As you can see..." — just say the thing.
- No greetings, no "Welcome to this lesson" openers, no "Let's dive in" filler. Start narration for slide 1 by orienting the learner in one sentence, not by greeting them.
- Never repeat a bullet point word-for-word in narration — narration adds the reasoning, the "why," or a clarifying example the bullet doesn't have room for.
- Connect slides with a short natural transition at the start or end of narration where it helps ("Now that you've seen X, here's where it breaks down in practice." not "Moving on to the next slide.").
- Vary sentence openers across slides — don't start every slide's narration the same way.
- Bad: "On this slide, we can see the four components of an AI agent." Good: "An AI agent typically combines four capabilities: it can reason about a task, use tools to interact with external systems, maintain relevant context, and take actions toward a goal."`;

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

Diagrams — do NOT put a process/architecture/comparison/etc. explanation into "bullets" as a wall of text. Instead, for any slide of type process, architecture, comparison, diagram, or code, populate a structured "diagram" object so it renders as an actual visual (boxes, arrows, columns, a real table, or a real code block) — not bullet text. Diagram types available: ${DIAGRAM_TYPES.join(", ")}.
Diagram shapes by type:
- PROCESS / FLOW / TIMELINE: { "type": "PROCESS", "steps": [ { "label": "...", "description": "..." } ] } — 3-6 steps, left-to-right.
- CYCLE: same "steps" shape as PROCESS, used when the sequence repeats (e.g. an agent loop).
- COMPARISON: { "type": "COMPARISON", "columns": [ { "title": "...", "items": ["...","..."] }, { "title": "...", "items": ["...","..."] } ] } — 2-3 columns.
- ARCHITECTURE / HIERARCHY: { "type": "ARCHITECTURE", "boxes": [ { "label": "...", "description": "..." } ] } — 3-9 labeled components.
- TABLE: { "type": "TABLE", "rows": [ ["Header A","Header B"], ["row1a","row1b"] ] } — first row is the header.
- CODE: { "type": "CODE", "code": "actual code, \\n for line breaks", "language": "python" } — real, runnable-looking code, not pseudocode unless the concept is language-agnostic.
Leave "diagram" as null for slide types that don't need one (title, example, case-study, quiz, exercise, summary, transition) — those use plain "bullets"/"body" instead.

Quiz: write questions that test applying the concept to a scenario, not naming definitions. Each question must map to one of the learning objectives.

Return JSON exactly in this shape:
{
  "learningObjectives": ["..."],
  "sections": [ { "heading": "...", "body": "..." } ],
  "slides": [
    {
      "order": 1, "type": "title", "title": "...", "subtitle": "", "bullets": [],
      "body": "", "visualPrompt": "", "diagram": null, "speakerNotes": "", "narration": "...", "estimatedSeconds": 40
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
  // not just malformed. Configurable so an admin can raise it (or a future
  // section-by-section generation strategy can lower it) without a deploy.
  const settings = await getOrCreateCourseFactorySettings();
  const maxTokens = settings.lessonContentMaxTokens || 16000;
  const result = await callClaude({ system, prompt, maxTokens, tier: "standard" });
  const tokensIn = result.usage?.input_tokens || 0;
  const tokensOut = result.usage?.output_tokens || 0;
  const costUsd = estimateCostUsd(result.model, tokensIn, tokensOut);
  await recordCourseFactorySpend(costUsd);

  // Truncation is detected and rejected BEFORE attempting to parse — a
  // truncated response is incomplete, not malformed, so no amount of JSON
  // repair can recover it. Spend is still recorded above (tokens were
  // genuinely consumed) but nothing incomplete is ever parsed, validated, or
  // returned to the caller for persistence.
  if (result.stopReason === "max_tokens") {
    throw new LessonContentTruncatedError(maxTokens);
  }

  const parsed = extractJson(result.text);
  validateLessonContent(parsed);
  return { content: parsed, model: result.model, usage: result.usage, costUsd };
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
    if (slide.diagram) {
      if (!DIAGRAM_TYPES.includes(slide.diagram.type)) {
        throw new Error(`Slide ${i + 1} has an invalid diagram type: ${slide.diagram.type}`);
      }
      const needsSteps = ["PROCESS", "CYCLE", "FLOW", "TIMELINE"].includes(slide.diagram.type);
      const needsColumns = slide.diagram.type === "COMPARISON";
      const needsBoxes = ["ARCHITECTURE", "HIERARCHY"].includes(slide.diagram.type);
      const needsRows = slide.diagram.type === "TABLE";
      const needsCode = slide.diagram.type === "CODE";
      if (needsSteps && (!Array.isArray(slide.diagram.steps) || slide.diagram.steps.length === 0)) {
        throw new Error(`Slide ${i + 1} diagram (${slide.diagram.type}) is missing "steps"`);
      }
      if (needsColumns && (!Array.isArray(slide.diagram.columns) || slide.diagram.columns.length === 0)) {
        throw new Error(`Slide ${i + 1} diagram (COMPARISON) is missing "columns"`);
      }
      if (needsBoxes && (!Array.isArray(slide.diagram.boxes) || slide.diagram.boxes.length === 0)) {
        throw new Error(`Slide ${i + 1} diagram (${slide.diagram.type}) is missing "boxes"`);
      }
      if (needsRows && (!Array.isArray(slide.diagram.rows) || slide.diagram.rows.length === 0)) {
        throw new Error(`Slide ${i + 1} diagram (TABLE) is missing "rows"`);
      }
      if (needsCode && !slide.diagram.code) {
        throw new Error(`Slide ${i + 1} diagram (CODE) is missing "code"`);
      }
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
