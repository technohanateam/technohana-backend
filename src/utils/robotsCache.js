import axios from "axios";
import robotsParser from "robots-parser";

// In-memory per-domain robots.txt cache. Single-instance deployment (Railway) —
// no need for a distributed cache. Missing/unreachable robots.txt defaults to
// "allow" (standard crawler convention: no robots.txt does not mean disallow).
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // hostname -> { parser, fetchedAt }

async function getParser(hostname, robotsUrl, userAgent) {
  const cached = cache.get(hostname);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.parser;
  }

  let body = "";
  try {
    const res = await axios.get(robotsUrl, {
      timeout: 8000,
      headers: { "User-Agent": userAgent },
      validateStatus: () => true,
    });
    if (res.status >= 200 && res.status < 300) {
      body = res.data;
    }
    // Any other status (404, 403, 5xx, timeout) — treat as "no robots.txt", allow by default.
  } catch {
    body = "";
  }

  const parser = robotsParser(robotsUrl, typeof body === "string" ? body : "");
  cache.set(hostname, { parser, fetchedAt: Date.now() });
  return parser;
}

export async function isFetchAllowed(url, userAgent) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
  const parser = await getParser(parsed.host, robotsUrl, userAgent);

  const allowed = parser.isAllowed(url, userAgent);
  // robots-parser returns undefined when it can't determine a rule — default to allow.
  return allowed !== false;
}

export function clearRobotsCache() {
  cache.clear();
}
