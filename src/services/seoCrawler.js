import axios from "axios";
import * as cheerio from "cheerio";
import SeoCrawlRun from "../models/seoCrawlRun.model.js";
import SeoCrawlPage from "../models/seoCrawlPage.model.js";

const ISSUE = {
  MISSING_TITLE: "MISSING_TITLE",
  TITLE_TOO_LONG: "TITLE_TOO_LONG",
  MISSING_META_DESCRIPTION: "MISSING_META_DESCRIPTION",
  META_TOO_LONG: "META_TOO_LONG",
  MISSING_H1: "MISSING_H1",
  MULTIPLE_H1: "MULTIPLE_H1",
  MISSING_ALT: "MISSING_ALT",
  BROKEN_LINK: "BROKEN_LINK",
  BROKEN_IMAGE: "BROKEN_IMAGE",
  SLOW_PAGE: "SLOW_PAGE",
  MISSING_CANONICAL: "MISSING_CANONICAL",
  NOINDEX_PAGE: "NOINDEX_PAGE",
  THIN_CONTENT: "THIN_CONTENT",
  LARGE_IMAGE: "LARGE_IMAGE",
};

const SUMMARY_KEY_BY_ISSUE = {
  [ISSUE.MISSING_TITLE]: "missingTitle",
  [ISSUE.TITLE_TOO_LONG]: "titleTooLong",
  [ISSUE.MISSING_META_DESCRIPTION]: "missingMetaDescription",
  [ISSUE.META_TOO_LONG]: "metaTooLong",
  [ISSUE.MISSING_H1]: "missingH1",
  [ISSUE.MULTIPLE_H1]: "multipleH1",
  [ISSUE.MISSING_ALT]: "missingAlt",
  [ISSUE.BROKEN_LINK]: "brokenLinks",
  [ISSUE.BROKEN_IMAGE]: "brokenImages",
  [ISSUE.SLOW_PAGE]: "slowPages",
  [ISSUE.MISSING_CANONICAL]: "missingCanonical",
  [ISSUE.NOINDEX_PAGE]: "noindexPages",
  [ISSUE.THIN_CONTENT]: "thinPages",
  [ISSUE.LARGE_IMAGE]: "largeImages",
};

const LARGE_IMAGE_BYTES = 500 * 1024;
const SLOW_PAGE_MS = 3000;
const THIN_CONTENT_WORDS = 300;
const TITLE_MAX = 60;
const META_MAX = 160;

// Minimal robots.txt parser — enough to respect `Disallow` rules for `User-agent: *`.
async function loadDisallowedPaths(baseUrl) {
  try {
    const { data, status } = await axios.get(new URL("/robots.txt", baseUrl).href, {
      timeout: 8000,
      validateStatus: () => true,
    });
    if (status >= 400 || typeof data !== "string") return [];

    const lines = data.split("\n").map((l) => l.trim());
    const disallowed = [];
    let inWildcardGroup = false;
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey?.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        inWildcardGroup = value === "*";
      } else if (key === "disallow" && inWildcardGroup && value) {
        disallowed.push(value);
      }
    }
    return disallowed;
  } catch {
    return [];
  }
}

function isDisallowed(pathname, disallowedPaths) {
  return disallowedPaths.some((prefix) => pathname.startsWith(prefix));
}

// Tiny concurrency limiter — avoids adding a new dependency for this.
function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

async function checkLinkAlive(url, cache) {
  if (cache.has(url)) return cache.get(url);
  const result = await axios
    .head(url, { timeout: 8000, validateStatus: () => true })
    .then((res) => res.status < 400)
    .catch(() => false);
  cache.set(url, result);
  return result;
}

async function checkImage(url, cache) {
  if (cache.has(url)) return cache.get(url);
  const result = await axios
    .head(url, { timeout: 8000, validateStatus: () => true })
    .then((res) => ({
      broken: res.status >= 400,
      sizeBytes: Number(res.headers["content-length"]) || 0,
    }))
    .catch(() => ({ broken: true, sizeBytes: 0 }));
  cache.set(url, result);
  return result;
}

function computeIssues(page) {
  const issues = [];
  if (!page.title) issues.push(ISSUE.MISSING_TITLE);
  else if (page.titleLength > TITLE_MAX) issues.push(ISSUE.TITLE_TOO_LONG);

  if (!page.metaDescription) issues.push(ISSUE.MISSING_META_DESCRIPTION);
  else if (page.metaDescriptionLength > META_MAX) issues.push(ISSUE.META_TOO_LONG);

  if (page.h1Tags.length === 0) issues.push(ISSUE.MISSING_H1);
  else if (page.h1Tags.length > 1) issues.push(ISSUE.MULTIPLE_H1);

  if (!page.canonicalUrl) issues.push(ISSUE.MISSING_CANONICAL);
  if (page.isNoindex) issues.push(ISSUE.NOINDEX_PAGE);
  if (page.wordCount < THIN_CONTENT_WORDS) issues.push(ISSUE.THIN_CONTENT);
  if (page.loadTimeMs > SLOW_PAGE_MS) issues.push(ISSUE.SLOW_PAGE);
  if (page.brokenLinks.length > 0) issues.push(ISSUE.BROKEN_LINK);
  if (page.images.some((img) => !img.alt)) issues.push(ISSUE.MISSING_ALT);
  if (page.images.some((img) => img.sizeBytes && img.sizeBytes > LARGE_IMAGE_BYTES)) issues.push(ISSUE.LARGE_IMAGE);
  if (page.images.some((img) => img.broken)) issues.push(ISSUE.BROKEN_IMAGE);

  return issues;
}

export function extractPageData(html, pageUrl, statusCode, loadTimeMs, origin) {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || "";
  const canonicalUrl = $('link[rel="canonical"]').attr("href") || "";
  const isNoindex = /noindex/i.test($('meta[name="robots"]').attr("content") || "");
  const h1Tags = $("h1")
    .map((_, el) => $(el).text().trim())
    .get();
  const h2Count = $("h2").length;
  const wordCount = $("body").text().trim().split(/\s+/).filter(Boolean).length;

  const internalLinks = [];
  const externalLinks = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    try {
      const resolved = new URL(href, pageUrl).href;
      if (new URL(resolved).origin === origin) internalLinks.push(resolved);
      else externalLinks.push(resolved);
    } catch {
      // ignore malformed hrefs
    }
  });

  const images = $("img")
    .map((_, el) => {
      const src = $(el).attr("src");
      const alt = $(el).attr("alt") || "";
      if (!src) return null;
      try {
        return { src: new URL(src, pageUrl).href, alt };
      } catch {
        return null;
      }
    })
    .get()
    .filter(Boolean);

  return {
    url: pageUrl,
    statusCode,
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    canonicalUrl,
    isNoindex,
    h1Tags,
    h2Count,
    wordCount,
    loadTimeMs,
    internalLinks: [...new Set(internalLinks)],
    externalLinks: [...new Set(externalLinks)],
    images,
    brokenLinks: [],
  };
}

export async function runCrawl({ baseUrl, maxPages = 500, concurrency = 5, triggeredBy = "manual" }) {
  const origin = new URL(baseUrl).origin;
  const disallowedPaths = await loadDisallowedPaths(baseUrl);

  const run = await SeoCrawlRun.create({ baseUrl, triggeredBy, status: "running" });

  const visited = new Set();
  const queue = [baseUrl];
  const linkCheckCache = new Map();
  const imageCheckCache = new Map();
  const limiter = createLimiter(concurrency);
  const titleCounts = new Map();
  const descriptionCounts = new Map();

  let pagesCrawled = 0;
  let pagesErrored = 0;
  let pagesSkippedRobots = 0;

  while (queue.length > 0 && pagesCrawled < maxPages) {
    const batch = queue.splice(0, Math.min(concurrency, maxPages - pagesCrawled));
    const results = await Promise.all(
      batch.map((url) =>
        limiter(async () => {
          if (visited.has(url)) return null;
          visited.add(url);

          const pathname = new URL(url).pathname;
          if (isDisallowed(pathname, disallowedPaths)) {
            pagesSkippedRobots += 1;
            return null;
          }

          const started = Date.now();
          try {
            const res = await axios.get(url, { timeout: 15000, validateStatus: () => true });
            const loadTimeMs = Date.now() - started;
            if (res.status >= 400) {
              pagesErrored += 1;
              return null;
            }
            const contentType = res.headers["content-type"] || "";
            if (!contentType.includes("text/html")) return null;

            const pageData = extractPageData(res.data, url, res.status, loadTimeMs, origin);
            return pageData;
          } catch {
            pagesErrored += 1;
            return null;
          }
        })
      )
    );

    for (const pageData of results) {
      if (!pageData) continue;
      for (const link of pageData.internalLinks) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }

    // Broken-link checks, deduped across the whole run via linkCheckCache.
    for (const pageData of results) {
      if (!pageData) continue;
      const checks = await Promise.all(
        pageData.internalLinks.map(async (link) => ({
          link,
          alive: await checkLinkAlive(link, linkCheckCache),
        }))
      );
      pageData.brokenLinks = checks.filter((c) => !c.alive).map((c) => c.link);

      pageData.images = await Promise.all(
        pageData.images.map(async (img) => {
          const { broken, sizeBytes } = await checkImage(img.src, imageCheckCache);
          return { ...img, broken, sizeBytes };
        })
      );

      pageData.issues = computeIssues(pageData);

      if (pageData.title) titleCounts.set(pageData.title, (titleCounts.get(pageData.title) || 0) + 1);
      if (pageData.metaDescription) {
        descriptionCounts.set(pageData.metaDescription, (descriptionCounts.get(pageData.metaDescription) || 0) + 1);
      }

      await SeoCrawlPage.findOneAndUpdate(
        { crawlRunId: run._id, url: pageData.url },
        { $set: { ...pageData, crawlRunId: run._id } },
        { upsert: true }
      );
      pagesCrawled += 1;
    }
  }

  // Duplicate title/description detection needs the full set, done after crawl.
  const duplicateTitles = [...titleCounts.values()].filter((c) => c > 1).length;
  const duplicateDescriptions = [...descriptionCounts.values()].filter((c) => c > 1).length;

  const pages = await SeoCrawlPage.find({ crawlRunId: run._id }).lean();
  const summary = {
    duplicateTitles,
    duplicateDescriptions,
  };
  for (const page of pages) {
    for (const issue of page.issues || []) {
      const key = SUMMARY_KEY_BY_ISSUE[issue];
      if (key) summary[key] = (summary[key] || 0) + 1;
    }
  }

  run.status = "completed";
  run.finishedAt = new Date();
  run.pagesCrawled = pagesCrawled;
  run.pagesErrored = pagesErrored;
  run.pagesSkippedRobots = pagesSkippedRobots;
  run.summary = summary;
  await run.save();

  return run;
}

export { ISSUE, computeIssues };
