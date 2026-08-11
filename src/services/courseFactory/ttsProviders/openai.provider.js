import OpenAI from "openai";

let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

// Uses the already-installed OpenAI SDK's TTS endpoint — no new AI vendor
// needed for Phase 1 (spec §15 requires a provider abstraction, not a
// specific vendor; this is the sole provider wired up for now).
export async function generateOpenAiSpeech({ text, voice = "alloy" }) {
  try {
    const response = await getClient().audio.speech.create({
      model: "tts-1",
      voice,
      input: text,
      response_format: "mp3",
    });
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    // Rethrow with the SDK's real HTTP status attached (never the key or raw
    // request/response body) so classifyTtsError() can distinguish 401 (bad
    // key) from 429 (rate limit) from a transient 5xx — the SDK's own error
    // already carries `.status` for API errors, this just makes it the
    // contract callers rely on instead of reaching into the SDK error shape.
    const status = err?.status || err?.response?.status || null;
    const message = status ? `OpenAI TTS request failed (HTTP ${status})` : `OpenAI TTS request failed: ${err.message}`;
    const wrapped = new Error(message);
    wrapped.status = status;
    throw wrapped;
  }
}
