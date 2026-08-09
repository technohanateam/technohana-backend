import { v2 as cloudinary } from "cloudinary";
import { generateOpenAiSpeech } from "./ttsProviders/openai.provider.js";
import { getOrCreateCourseFactorySettings } from "../../models/courseFactory/courseFactorySettings.model.js";

const PROVIDERS = {
  openai: generateOpenAiSpeech,
};

// Terms that need careful handling per spec §16 — kept as a validation flag,
// not auto-corrected (SSML/pronunciation lexicons are provider-specific and
// out of scope for the single OpenAI provider wired up in Phase 1).
const PRONUNCIATION_SENSITIVE_TERMS = ["LangGraph", "LangChain", "MCP", "RAG", "LLM", "API", "OpenAI", "Anthropic", "Azure"];

// Narration validation per spec §16 — run before any TTS call is made.
export function validateNarration(text) {
  const issues = [];
  if (!text || !text.trim()) {
    issues.push("Narration is empty");
    return { valid: false, issues };
  }
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 5) issues.push(`Narration is unusually short (${wordCount} words)`);
  if (wordCount > 220) issues.push(`Narration is unusually long for one slide (${wordCount} words) — consider splitting`);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) issues.push("Narration contains unsupported control characters");
  const termsUsed = PRONUNCIATION_SENSITIVE_TERMS.filter((t) => text.includes(t));
  return { valid: issues.length === 0, issues, termsUsed };
}

// Generates + uploads audio for one narration script. Provider selected via
// CourseFactorySettings.ttsProvider (env-configurable default), abstracted so
// a second provider can be added without touching call sites (spec §15).
export async function generateLessonAudio({ text, lessonSlug }) {
  const validation = validateNarration(text);
  if (!validation.valid) {
    throw new Error(`Narration failed validation: ${validation.issues.join("; ")}`);
  }

  const settings = await getOrCreateCourseFactorySettings();
  const providerName = process.env.TTS_PROVIDER || settings.ttsProvider || "openai";
  const voice = process.env.TTS_VOICE || settings.ttsVoice || "alloy";

  const generate = PROVIDERS[providerName];
  if (!generate) throw new Error(`Unknown TTS provider: ${providerName}`);

  const buffer = await generate({ text, voice });

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
  };
}
