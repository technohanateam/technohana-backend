// Block requests to internal/private IP ranges to prevent SSRF
const SSRF_BLOCKED_PATTERNS = [
  /^https?:\/\/169\.254\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/127\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/localhost/i,
];

export function isSsrfBlocked(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    return SSRF_BLOCKED_PATTERNS.some((re) => re.test(url));
  } catch {
    return true;
  }
}

const stripHtml = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();

// Fetches and extracts plain text from each URL server-side, then builds the
// Claude Pro prompt for a source-grounded blog. Shared by the standalone
// blog "Generate from URLs" flow and its Content Factory equivalent.
export async function fetchAndBuildUrlPrompt({ urls, topic, category, focusKeyword, relatedCourses = [] }) {
  const sourceSections = [];
  const sourcesList = [];
  const failedUrls = [];
  for (const url of urls) {
    try {
      const pageRes = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TechnohanaBot/1.0)" }, signal: AbortSignal.timeout(12000) });
      // fetch() only throws on network-level failures, not HTTP error statuses —
      // without this check a 404/500 page's own title (e.g. "Page Not Found")
      // would get cited as a legitimate source.
      if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
      const html = await pageRes.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const text = stripHtml(html).slice(0, 3000);
      sourceSections.push(`--- SOURCE: ${url} ---\n${text}`);
      sourcesList.push({ title: titleMatch ? stripHtml(titleMatch[1]).trim() : url, url });
    } catch {
      failedUrls.push(url);
      sourceSections.push(`--- SOURCE: ${url} ---\n[Could not fetch this URL]`);
    }
  }

  const topicLine = topic || "Determine the best topic from the source material.";
  const categoryLine = category || "";
  const keywordLine = focusKeyword || "";

  const sanitize = (str) => String(str || "").replace(/[`${}]/g, "");
  const relatedCoursesBullets = Array.isArray(relatedCourses) && relatedCourses.length
    ? relatedCourses.map(c => `  • <a href="/courses/${sanitize(c.id)}">${sanitize(c.title)}</a>`).join("\n")
    : "";
  const courseLinkInstruction = relatedCoursesBullets
    ? `conclusion with a call-to-action linking to <a href="https://technohana.in/courses">Technohana courses</a>. Also include internal links within the body prose (not in a separate list at the end): where topically relevant, link inline to 2–3 of these related Technohana courses using their exact URLs — do NOT invent a course or id that isn't in this list:\n${relatedCoursesBullets}\n  Do NOT add a standalone "Recommended Courses" section — all links must appear inside paragraph or list content`
    : `conclusion with a call-to-action linking to <a href="https://technohana.in/courses">Technohana courses</a>`;

  const systemPrompt = `You are Technohana's Senior Technical Content Writer.

You are given extracted content from trusted web pages.

Treat this content as your only factual source.

Rules:
Never invent facts.
Never invent statistics.
Never reference websites that are not included.
Never claim to have searched the web.
Summarize, synthesize and explain the provided material in your own words.
Write a high-quality SEO article.
Avoid copying long passages.
Return only valid JSON.`;

  const userPrompt = `Write a technical SEO blog using the source material below.

Topic: ${topicLine}
Category: ${categoryLine}
Preferred focus keyword: ${keywordLine}

Source Material:
${sourceSections.join("\n\n")}

Requirements:
700–1200 words
Introduction, 4–5 H2 sections, Conclusion, 3–5 FAQs
Short paragraphs. Use bullet points where useful.
Professional tone. Educational.
Do not mention that the content came from supplied sources.

Internal links — naturally include:
${courseLinkInstruction}

Return this JSON only:
{"title":"","slug":"","excerpt":"","content":"","metaTitle":"","metaDescription":"","focusKeyword":"","tags":[],"readTimeMin":0,"author":"","category":"","faqs":[]}`;

  return { sourceSections, sourcesList, failedUrls, systemPrompt, userPrompt };
}
