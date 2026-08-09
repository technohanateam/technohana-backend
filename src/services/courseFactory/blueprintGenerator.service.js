import { callClaude, extractJson } from "../aiAgent.service.js";
import { recordCourseFactorySpend, estimateCostUsd } from "./budgetGuard.service.js";
import { getOrCreateCourseFactorySettings } from "../../models/courseFactory/courseFactorySettings.model.js";

export class BlueprintTruncatedError extends Error {
  constructor(maxTokens) {
    super(`Course blueprint generation was truncated at maxTokens=${maxTokens} (stop_reason: max_tokens) — response is incomplete. Raise CourseFactorySettings.blueprintMaxTokens (or reduce moduleCount/lessonsPerModule) and retry.`);
    this.name = "BlueprintTruncatedError";
    this.maxTokens = maxTokens;
  }
}

// Turns admin-supplied course inputs into an editable course + module + lesson
// title skeleton. No lesson content is generated here — the admin reviews and
// edits this blueprint before any lesson-level generation is triggered
// (spec §9: "the administrator MUST be able to edit the blueprint").
export async function generateCourseBlueprint({ title, audience, level, durationHours, moduleCount, lessonsPerModule, technology, teachingStyle }) {
  const system = `You are an instructional designer building a course syllabus for Technohana, an enterprise AI training company. Output ONLY a single JSON object, no prose, no markdown fences.`;

  const prompt = `Design a course blueprint.

Course title: ${title}
Target audience: ${audience}
Skill level: ${level}
Total duration: ${durationHours} hours
Modules: ${moduleCount}
Lessons per module: ${lessonsPerModule}
Technology focus: ${technology || "general"}
Teaching style: ${teachingStyle || "practical, outcome-oriented"}

Rules:
- Each lesson should be achievable in 10-25 minutes.
- Do not pad lesson counts — if fewer lessons genuinely cover the module well, use fewer.
- Avoid generic filler lesson titles; each lesson title must be a specific, teachable unit.

Return JSON exactly in this shape:
{
  "subtitle": "one-line course subtitle",
  "description": "2-3 sentence course description",
  "category": "short category label",
  "learningObjectives": ["...", "..."],
  "skills": ["...", "..."],
  "capstone": { "title": "...", "description": "...", "deliverable": "..." },
  "modules": [
    {
      "title": "...",
      "description": "...",
      "learningObjectives": ["..."],
      "lessons": [
        { "title": "...", "description": "...", "durationMinutes": 15 }
      ]
    }
  ]
}`;

  const settings = await getOrCreateCourseFactorySettings();
  const maxTokens = settings.blueprintMaxTokens || 8000;
  const result = await callClaude({ system, prompt, maxTokens, tier: "standard" });
  const tokensIn = result.usage?.input_tokens || 0;
  const tokensOut = result.usage?.output_tokens || 0;
  const costUsd = estimateCostUsd(result.model, tokensIn, tokensOut);
  await recordCourseFactorySpend(costUsd);

  if (result.stopReason === "max_tokens") {
    throw new BlueprintTruncatedError(maxTokens);
  }

  const parsed = extractJson(result.text);
  validateBlueprint(parsed, { moduleCount });
  return { blueprint: parsed, model: result.model, usage: result.usage, costUsd };
}

function validateBlueprint(blueprint, { moduleCount }) {
  if (!blueprint || typeof blueprint !== "object") throw new Error("Blueprint response was not a JSON object");
  if (!Array.isArray(blueprint.modules) || blueprint.modules.length === 0) throw new Error("Blueprint has no modules");
  if (moduleCount && Math.abs(blueprint.modules.length - moduleCount) > 2) {
    throw new Error(`Blueprint returned ${blueprint.modules.length} modules, expected around ${moduleCount}`);
  }
  for (const mod of blueprint.modules) {
    if (!mod.title || !Array.isArray(mod.lessons) || mod.lessons.length === 0) {
      throw new Error(`Module "${mod.title || "(untitled)"}" is missing lessons`);
    }
    for (const lesson of mod.lessons) {
      if (!lesson.title) throw new Error("A lesson in the blueprint is missing a title");
    }
  }
}
