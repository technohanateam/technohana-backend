import xss from "xss";
import { Blogs } from "../models/blogs.model.js";

// Extracted from admin.routes.js's `POST /admin/blogs` handler (the ONE
// legitimate refactor of existing blog code the AI Content Factory plan
// allows) so both that route and the new content-factory approve endpoint
// share identical blog-creation behaviour instead of duplicating it.
//
// The XSS whitelist below is intentionally a duplicate of admin.routes.js's
// local `XSS_OPTIONS`, not an import from that file — admin.routes.js is an
// Express router module, not a library module, and importing from it would
// create an awkward router->service->router dependency. Keeping it as an
// exact copy here is the lower-risk option: admin.routes.js's own sanitizer
// (used by PUT /blogs/:id, rewrite, etc.) is left completely untouched.
const XSS_OPTIONS = new xss.FilterXSS({
  whiteList: {
    p: ["class", "id"], h2: ["class", "id"], h3: ["class", "id"],
    ul: ["class", "id"], ol: ["class", "id"], li: ["class", "id"],
    strong: [], em: [], br: [], hr: [],
    a: ["href", "target", "rel"],
    blockquote: ["class", "id"],
    span: ["class", "id"], div: ["class", "id"],
    table: ["class", "id"], thead: [], tbody: [], tr: [], th: ["class", "id"], td: ["class", "id"],
    img: ["src", "alt", "width", "height", "loading", "class", "id"],
    figure: ["class", "id"], figcaption: [],
    code: ["class", "id"], pre: ["class", "id"],
  },
  onTagAttr: (tag, name, value) => {
    if (name === "href" && !/^https?:|^mailto:|^\//i.test(value)) return "";
    if (name === "src" && !/^https?:|^\//i.test(value)) return "";
  },
});

const sanitizeContent = (content) => (content ? XSS_OPTIONS.process(content) : content);

// Builds and saves a Blogs doc from a payload. Byte-identical behaviour to
// the original inline POST /blogs handler: same validation, same slug
// generation/collision check, same defaults, same thrown-error shape (via
// `.statusCode`/`.message`, which the caller maps onto the same HTTP
// responses the route used to send directly).
export async function createBlogFromPayload(payload = {}) {
  const {
    title, slug, img, author, date, content, category, excerpt,
    metaTitle, metaDescription, focusKeyword, tags, readTimeMin, sources, faqs,
    sourceOpportunityId,
  } = payload;

  if (!title) {
    const err = new Error("Title is required.");
    err.statusCode = 400;
    throw err;
  }

  const lastBlog = await Blogs.findOne().sort({ id: -1 }).lean();
  const nextId = lastBlog ? (lastBlog.id || 0) + 1 : 1;

  const generatedSlug =
    slug ||
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  const existing = await Blogs.findOne({ slug: generatedSlug });
  if (existing) {
    const err = new Error("A blog with this slug already exists.");
    err.statusCode = 409;
    throw err;
  }

  const blog = new Blogs({
    id: nextId,
    title,
    slug: generatedSlug,
    img: img || "",
    author: author || "",
    date: date || new Date().toISOString().split("T")[0],
    content: sanitizeContent(content) || "",
    category: category || "",
    excerpt: excerpt || "",
    metaTitle: metaTitle || "",
    metaDescription: metaDescription || "",
    focusKeyword: focusKeyword || "",
    tags: tags || [],
    readTimeMin: readTimeMin || null,
    sources: sources || [],
    faqs: faqs || [],
    sourceOpportunityId: sourceOpportunityId || null,
  });
  await blog.save();
  return blog;
}
