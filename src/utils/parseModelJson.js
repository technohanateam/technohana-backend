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

function escapeControlCharsInStrings(str) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (const ch of str) {
    if (inString) {
      if (escaped) { result += ch; escaped = false; }
      else if (ch === "\\") { result += ch; escaped = true; }
      else if (ch === '"') { result += ch; inString = false; }
      else if (ch === "\n") result += "\\n";
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
