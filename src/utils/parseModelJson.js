// Extracts and parses a JSON object from an LLM response. LLMs frequently emit
// raw control characters (literal newlines/tabs) inside multi-line string
// values (e.g. HTML content), which JSON.parse rejects even though the
// surrounding object structure is otherwise well-formed. This repairs that
// before parsing, without touching structural JSON whitespace.
function pasteParseError(message) {
  const err = new Error(message);
  err.code = "PASTE_PARSE";
  return err;
}

export function parseModelJson(text) {
  if (!text || typeof text !== "string") {
    throw pasteParseError("No response text provided to parse");
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw pasteParseError("No JSON object found in model response");
  }
  const sliced = text.slice(start, end + 1);
  const controlCharsFixed = escapeControlCharsInStrings(sliced);
  try {
    return JSON.parse(controlCharsFixed);
  } catch (firstError) {
    // Fallback only — never runs on an already-valid response. A live
    // validation run (2026-08-08) found a content-brief response fail here:
    // a heading/example string containing a literal, unescaped `"` (e.g. a
    // quoted phrase) makes escapeControlCharsInStrings' quote-boundary
    // tracking end the string early, corrupting everything after it. This is
    // a best-effort heuristic second pass, not a guarantee — if it also
    // fails, the original error is what surfaces (more informative than the
    // heuristic's own error).
    try {
      return JSON.parse(escapeStrayQuotesInStrings(controlCharsFixed));
    } catch {
      // Pasted-from-chat-UI damage: curly quotes, single-quoted keys,
      // comments, trailing commas. Normalized only after the passes above fail.
      try {
        return JSON.parse(repairPastedJson(sliced));
      } catch {
        const snippet = text.trim().slice(0, 80).replace(/\s+/g, " ");
        throw pasteParseError(`${firstError.message} (response began: "${snippet}")`);
      }
    }
  }
}

function repairPastedJson(str) {
  const normalized = str
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'");
  let result = "";
  let quote = null;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (quote) {
      if (ch === "\\") {
        result += ch + (normalized[i + 1] || "");
        i += 1;
      } else if (ch === quote) {
        result += '"';
        quote = null;
      } else if (ch === '"') {
        result += '\\"';
      } else if (ch === "\n") result += "\\n";
      else if (ch === "\r") result += "\\r";
      else if (ch === "\t") result += "\\t";
      else result += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      result += '"';
    } else if (ch === "/" && normalized[i + 1] === "/") {
      while (i < normalized.length && normalized[i] !== "\n") i += 1;
    } else if (ch === "/" && normalized[i + 1] === "*") {
      const close = normalized.indexOf("*/", i + 2);
      i = close === -1 ? normalized.length : close + 1;
    } else {
      result += ch;
    }
  }
  return result
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_][\w]*)(\s*:)/g, '$1"$2"$3');
}

// Re-walks the string tracking JSON structural position; inside a string
// value, a `"` is only treated as the real closing quote if the next
// non-whitespace character is a valid JSON continuation (`,` `}` `]` `:`) —
// otherwise it's escaped as a literal quote and the string is kept open.
function escapeStrayQuotesInStrings(str) {
  let result = "";
  let inString = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "\\" && inString) {
      result += ch + (str[i + 1] || "");
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        result += ch;
        inString = true;
        continue;
      }
      let j = i + 1;
      while (j < str.length && /\s/.test(str[j])) j += 1;
      const next = str[j];
      if (next === "," || next === "}" || next === "]" || next === ":" || next === undefined) {
        result += ch;
        inString = false;
      } else {
        result += '\\"';
      }
      continue;
    }
    result += ch;
  }
  return result;
}

const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

function escapeControlCharsInStrings(str) {
  let result = "";
  let inString = false;
  let pendingBackslash = false;
  for (const ch of str) {
    if (inString) {
      if (pendingBackslash) {
        pendingBackslash = false;
        if (VALID_JSON_ESCAPES.has(ch)) {
          result += "\\" + ch;
        } else {
          // The backslash wasn't followed by a real escape target — it was a
          // stray/dangling backslash (e.g. a Windows path right before a raw
          // line break), not a genuine escape sequence. Escape the backslash
          // itself and handle this character on its own merits below.
          result += "\\\\";
          if (ch === "\n") result += "\\n";
          else if (ch === "\r") result += "\\r";
          else if (ch === "\t") result += "\\t";
          else if (ch === '"') { result += ch; inString = false; }
          else result += ch;
        }
      } else if (ch === "\\") {
        pendingBackslash = true;
      } else if (ch === '"') {
        result += ch; inString = false;
      } else if (ch === "\n") result += "\\n";
      else if (ch === "\r") result += "\\r";
      else if (ch === "\t") result += "\\t";
      else result += ch;
    } else {
      result += ch;
      if (ch === '"') inString = true;
    }
  }
  return result;
}
