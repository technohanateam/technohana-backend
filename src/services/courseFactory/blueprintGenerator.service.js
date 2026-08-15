import { extractJson } from "../aiAgent.service.js";

// Builds the blueprint prompt for the admin to run manually through Claude
// Pro (see aiAgent.service.js — ANTHROPIC_API_KEY has no working billing, so
// this pipeline no longer calls the API directly; mirrors Content Factory's
// manual workflow, see contentFactory/*WriterPrompt functions). No lesson
// content is generated here — the admin reviews and edits the parsed
// blueprint before any lesson-level generation is triggered (spec §9: "the
// administrator MUST be able to edit the blueprint").
export async function buildBlueprintPrompt({ title, audience, level, durationHours, moduleCount, lessonsPerModule, technology, teachingStyle }) {
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

  return { system, prompt };
}

// Parses the admin's pasted Claude Pro response into a validated blueprint.
// No cost tracking here — manual Claude Pro usage isn't billed per-call
// through our API key, so there's nothing to record (mirrors Content
// Factory's parse* functions after fda0261).
export function parseBlueprintResponse(text, { moduleCount } = {}) {
  if (!text || !String(text).trim()) throw new Error("No blueprint response provided.");
  const parsed = extractJson(text);
  validateBlueprint(parsed, { moduleCount });
  return { blueprint: parsed };
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
