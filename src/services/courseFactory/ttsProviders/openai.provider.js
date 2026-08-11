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
  const response = await getClient().audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
    response_format: "mp3",
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
