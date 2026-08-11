import { v2 as cloudinary } from "cloudinary";
import { generateOpenAiSpeech } from "./ttsProviders/openai.provider.js";
import { getOrCreateCourseFactorySettings } from "../../models/courseFactory/courseFactorySettings.model.js";

const PROVIDERS = {
  openai: generateOpenAiSpeech,
};

// Terms that need careful handling per spec §16/§7 — kept as a validation
// flag for human review, not auto-corrected. IMPORTANT, honest limitation:
// OpenAI's tts-1 (the only provider wired up in Phase 1) exposes no SSML,
// phoneme, or pronunciation-lexicon API — there is nothing this codebase can
// call to actually change how it pronounces "MCP" or "LangGraph". Flagging
// these terms lets an admin listen during the audio-preview step (Lesson
// Editor "Narration & Audio" tab) and manually reword the narration if a
// term comes out wrong — that's the real, honest mitigation available today.
// A provider with real pronunciation control (Azure Speech, Google Cloud TTS
// both support SSML <phoneme>/<say-as>) would need its own ttsProviders/*
// module — the abstraction in generateLessonAudio() below is already built
// for that; only the provider implementation is missing.
const PRONUNCIATION_SENSITIVE_TERMS = [
  "AI", "LLM", "API", "RAG", "MCP",
  "LangChain", "LangGraph", "CrewAI", "AutoGen",
  "OpenAI", "Anthropic", "Azure", "AI Foundry", "Claude", "GPT",
];

// OpenAI's tts-1 speech endpoint hard-rejects input over 4096 characters —
// this is the provider's real documented limit, not a stylistic preference.
// Found via a real E2E run: the whole-lesson transcript (16 slides, 1356
// words / ~7500 chars) exceeded it. There is currently no per-slide/per-
// chunk TTS generation + audio stitching in this pipeline, so any lesson
// whose full transcript exceeds this genuinely cannot produce audio in one
// call today — that's a real architecture gap (chunked generation +
// concatenation), not something a validation threshold can paper over.
const OPENAI_TTS_CHAR_LIMIT = 4096;

// Narration validation per spec §16 — run before any TTS call is made.
// `context` distinguishes what's being validated: "slide" (a single slide's
// narration, expected to be short) vs "lesson" (the full concatenated
// transcript the AUDIO step actually sends to the provider in one call).
export function validateNarration(text, { context = "slide" } = {}) {
  const issues = [];
  if (!text || !text.trim()) {
    issues.push("Narration is empty");
    return { valid: false, issues };
  }
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 5) issues.push(`Narration is unusually short (${wordCount} words)`);

  if (context === "lesson") {
    if (text.length > OPENAI_TTS_CHAR_LIMIT) {
      issues.push(`Full-lesson narration is ${text.length} characters — exceeds the TTS provider's ${OPENAI_TTS_CHAR_LIMIT}-character limit per request. This lesson's transcript is too long for single-call audio generation (no per-slide/chunked TTS is implemented yet).`);
    }
  } else if (wordCount > 220) {
    issues.push(`Narration is unusually long for one slide (${wordCount} words) — consider splitting`);
  }

  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) issues.push("Narration contains unsupported control characters");
  const termsUsed = PRONUNCIATION_SENSITIVE_TERMS.filter((t) => text.includes(t));
  return { valid: issues.length === 0, issues, termsUsed };
}

// Generates + uploads audio for one narration script. Provider selected via
// CourseFactorySettings.ttsProvider (env-configurable default), abstracted so
// a second provider can be added without touching call sites (spec §15).
export async function generateLessonAudio({ text, lessonSlug }) {
  const validation = validateNarration(text, { context: "lesson" });
  if (!validation.valid) {
    throw new Error(`Narration failed validation: ${validation.issues.join("; ")}`);
  }

  const settings = await getOrCreateCourseFactorySettings();
  const providerName = process.env.TTS_PROVIDER || settings.ttsProvider || "openai";
  const voice = process.env.TTS_VOICE || settings.ttsVoice || "alloy";

  const generate = PROVIDERS[providerName];
  if (!generate) throw new Error(`Unknown TTS provider: ${providerName}`);

  const buffer = await generate({ text, voice });
  // Approximate, admin-configurable — not exact provider billing (same
  // caveat as the Claude cost tables elsewhere in this codebase).
  const costUsd = text.length * (settings.ttsCostPerCharUsd || 0);

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "technohana/academy/audio", resource_type: "video", public_id: `${lessonSlug}-${Date.now()}` },
      (err, r) => (err ? reject(err) : resolve(r))
    );
    stream.end(buffer);
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    durationSeconds: result.duration || 0,
    voice,
    provider: providerName,
    costUsd,
  };
}
