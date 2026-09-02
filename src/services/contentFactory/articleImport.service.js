import matter from "gray-matter";
import { marked } from "marked";
import { Blogs } from "../../models/blogs.model.js";
import ContentOpportunity from "../../models/contentOpportunity.model.js";
import { scoreDuplicateRisk } from "./duplicateDetection.service.js";

const DEFAULT_CONTENT_TYPE = "EXPERT_INSIGHT";

// Heading levels beyond h2/h3 have no equivalent in blogCreation.service.js's
// XSS whitelist (only p,h2,h3,ul,ol,li,strong,em,br,hr,a,blockquote,span,div,
// table*,img,figure,figcaption,code,pre survive). Rather than reject an import
// outright over heading choice, downgrade h1->h2 and h4-h6->h3 and surface a
// warning so the importer knows the structure was normalized.
function normalizeHeadings(html) {
  const warnings = [];
  let normalized = html.replace(/<h1(\s[^>]*)?>/gi, () => {
    warnings.push("Downgraded an <h1> to <h2> (whitelist has no h1).");
    return "<h2>";
  }).replace(/<\/h1>/gi, "</h2>");
  normalized = normalized.replace(/<h[456](\s[^>]*)?>/gi, () => {
    warnings.push("Downgraded a heading below h3 to <h3> (whitelist stops at h3).");
    return "<h3>";
  }).replace(/<\/h[456]>/gi, "</h3>");
  return { html: normalized, warnings };
}

// Parses a markdown file (frontmatter + body) into a Blogs-shaped articleDraft.
// Sanitization against the XSS whitelist happens once, downstream, inside
// createBlogFromPayload() at approval time — this function only needs to make
// sure heading levels are whitelist-compatible before that point.
export function parseMarkdownArticle(rawMarkdown) {
  const { data: front, content: body } = matter(rawMarkdown);
  const rawHtml = marked.parse(body);
  const { html, warnings } = normalizeHeadings(rawHtml);

  const articleDraft = {
    title: front.title || null,
    slug: front.slug || null,
    content: html,
    excerpt: front.excerpt || null,
    metaTitle: front.metaTitle || null,
    metaDescription: front.metaDescription || null,
    tags: Array.isArray(front.tags) ? front.tags : [],
    readTimeMin: front.readTimeMin || null,
    sources: Array.isArray(front.sources) ? front.sources : [],
    faqs: Array.isArray(front.faqs) ? front.faqs : [],
    focusKeyword: front.focusKeyword || null,
    author: front.author || null,
    category: front.category || null,
  };

  if (!articleDraft.title) warnings.push("No title found in frontmatter — the opportunity will need one before it can be approved.");
  if (!body || !body.trim()) warnings.push("Markdown body is empty.");

  return { articleDraft, warnings };
}

async function loadExistingCorpus() {
  const [blogs, opportunities] = await Promise.all([
    Blogs.find({}, { title: 1, slug: 1, focusKeyword: 1 }).lean(),
    ContentOpportunity.find({ status: { $nin: ["REJECTED", "FAILED"] } }, { title: 1, slug: 1, focusKeyword: 1, clusterId: 1, searchIntent: 1 }).lean(),
  ]);
  return [
    ...blogs.map((b) => ({ id: b._id, title: b.title, slug: b.slug, focusKeyword: b.focusKeyword, source: "blog" })),
    ...opportunities.map((o) => ({
      id: o._id,
      title: o.title,
      slug: o.slug,
      focusKeyword: o.focusKeyword,
      clusterId: o.clusterId,
      searchIntent: o.searchIntent,
      source: "opportunity",
    })),
  ];
}

// Builds (but does not save) a ContentOpportunity document from an already-
// parsed articleDraft. Lands in HUMAN_REVIEW directly — approveReviewItem /
// assertApprovable accept HUMAN_REVIEW without requiring the opportunity to
// have passed through GENERATING/AI_REVIEW first, so this surfaces in the
// existing review queue with no further plumbing.
//
// Shared by every non-AI-planned entry point into the pipeline (markdown
// import, "New Post", "Generate from Course", "Generate from URLs") — origin
// distinguishes them in sourceInfo. content may be empty (e.g. a blank "New
// Post" opportunity to be filled in during review); only title is required.
//
// Quality-gate scoring is intentionally skipped: qualityGate.service.js is a
// human-paste-back flow built around AI-generated drafts (fact-check/style/
// eval text pasted from Claude Pro) and has no automatic path for a
// human-written draft. overallScore is left at 0 for the admin to set via the
// existing PATCH /opportunities/:id/score (overrideScore) — the same escape
// hatch already used for exactly this kind of manual judgment call.
export async function buildOpportunityFromImport({ articleDraft, courseSlug = null, courseTitle = null, category = null, contentType, importedBy = null, sourceFile = null, origin = "MANUAL_IMPORT" }) {
  if (!articleDraft?.title) {
    const err = new Error("Article draft is missing a title.");
    err.statusCode = 400;
    throw err;
  }

  // Pasted model JSON sometimes returns sources as plain URL strings instead
  // of the {title, url} shape the schema requires — normalize both forms.
  if (Array.isArray(articleDraft.sources)) {
    articleDraft = {
      ...articleDraft,
      sources: articleDraft.sources
        .map((s) => {
          if (typeof s === "string") return { title: s, url: s };
          if (s && typeof s === "object" && s.url) return { title: s.title || s.url, url: s.url };
          return null;
        })
        .filter(Boolean),
    };
  }

  const corpus = await loadExistingCorpus();
  const { duplicateScore, cannibalizationRisk, signals } = scoreDuplicateRisk(
    { title: articleDraft.title, slug: articleDraft.slug, focusKeyword: articleDraft.focusKeyword, clusterId: null, searchIntent: null },
    corpus
  );

  const opportunity = new ContentOpportunity({
    title: articleDraft.title,
    slug: articleDraft.slug,
    courseSlug,
    courseTitle,
    contentType: contentType || DEFAULT_CONTENT_TYPE,
    category: category || articleDraft.category,
    focusKeyword: articleDraft.focusKeyword,
    duplicateScore,
    cannibalizationRisk,
    duplicateSignals: signals,
    overallScore: 0,
    sourceInfo: { origin, importedBy, importedAt: new Date(), sourceFile },
    status: "HUMAN_REVIEW",
    articleDraft,
  });

  return opportunity;
}
