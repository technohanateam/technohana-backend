// Extracts and parses a JSON object from an LLM response. LLMs frequently emit
// raw control characters (literal newlines/tabs) inside multi-line string
// values (e.g. HTML content), which JSON.parse rejects even though the
// surrounding object structure is otherwise well-formed. This repairs that
// before parsing, without touching structural JSON whitespace.
export function parseModelJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(escapeControlCharsInStrings(text.slice(start, end + 1)));
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
