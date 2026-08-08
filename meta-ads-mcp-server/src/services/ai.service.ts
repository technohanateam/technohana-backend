import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not configured; AI-assisted tools (recommendations, ad copy, reporting) are unavailable.',
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface AiCompletionOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/** Sends a single-turn prompt to Claude and returns the concatenated text response. */
export async function completeText(options: AiCompletionOptions): Promise<string> {
  const anthropic = getClient();
  const startedAt = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      system: options.system,
      messages: [{ role: 'user', content: options.prompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    logger.info({ durationMs: Date.now() - startedAt, model: env.ANTHROPIC_MODEL }, 'AI completion succeeded');
    return text;
  } catch (error) {
    logger.error({ err: error, durationMs: Date.now() - startedAt }, 'AI completion failed');
    throw error;
  }
}

const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

/**
 * LLMs frequently emit literal control characters (raw newlines/tabs) inside
 * multi-line string values even when told to return "just JSON," which
 * JSON.parse rejects even though the surrounding structure is well-formed.
 * This repairs that in-place without touching structural JSON whitespace.
 */
function escapeControlCharsInStrings(text: string): string {
  let result = '';
  let inString = false;
  let pendingBackslash = false;
  for (const ch of text) {
    if (inString) {
      if (pendingBackslash) {
        pendingBackslash = false;
        if (VALID_JSON_ESCAPES.has(ch)) {
          result += '\\' + ch;
        } else {
          result += '\\\\';
          if (ch === '\n') result += '\\n';
          else if (ch === '\r') result += '\\r';
          else if (ch === '\t') result += '\\t';
          else if (ch === '"') {
            result += ch;
            inString = false;
          } else result += ch;
        }
      } else if (ch === '\\') {
        pendingBackslash = true;
      } else if (ch === '"') {
        result += ch;
        inString = false;
      } else if (ch === '\n') result += '\\n';
      else if (ch === '\r') result += '\\r';
      else if (ch === '\t') result += '\\t';
      else result += ch;
    } else {
      result += ch;
      if (ch === '"') inString = true;
    }
  }
  return result;
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in model response. Raw response: ${text.slice(0, 500)}`);
  }
  return escapeControlCharsInStrings(text.slice(start, end + 1));
}

/** Sends a prompt expecting a strict JSON object response and parses it. */
export async function completeJson<T>(options: AiCompletionOptions): Promise<T> {
  const text = await completeText({
    ...options,
    system: `${options.system}\n\nRespond with ONLY a valid JSON object - no markdown fences, no commentary.`,
  });
  try {
    return JSON.parse(extractJsonObject(text)) as T;
  } catch (error) {
    throw new Error(`AI response was not valid JSON: ${(error as Error).message}`);
  }
}
