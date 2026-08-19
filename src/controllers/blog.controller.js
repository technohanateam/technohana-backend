import { Blogs } from "../models/blogs.model.js";

const LIST_PROJECTION = { content: 0, faqs: 0, sources: 0, metaTitle: 0, metaDescription: 0, focusKeyword: 0 };

// Single source of truth for "is this blog publicly visible right now" —
// every public-facing route (list, single-post JSON, SSR/OG crawler HTML)
// must use this, not hand-roll its own published/scheduledAt condition.
// A post only goes live once BOTH published:true AND its scheduledAt is
// null or already in the past (see also the identical convention in
// admin.routes.js's auto-schedule handler and contentCalendar.service.js).
export function buildPublicBlogFilter(now = new Date()) {
  return {
    published: true,
    $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }],
  };
}

// Pure JS mirror of buildPublicBlogFilter's semantics, for testing and for
// any in-process (non-Mongo-query) visibility check.
export function isPubliclyVisible(blog, now = new Date()) {
  if (!blog?.published) return false;
  if (blog.scheduledAt == null) return true;
  return new Date(blog.scheduledAt) <= now;
}

// ── Public blog listing: opt-in pagination/filter/search/facets ────────────
// Backward compatibility contract: with NO pagination params (page/limit),
// GET /blogs returns the historical bare array (full list). Multiple existing
// consumers (BlogPost related posts, homepage preview, sitemap, RSS) depend on
// that shape and on receiving the complete list, so it must never change here.
const MAX_BLOG_LIMIT = 50;
const DEFAULT_BLOG_LIMIT = 6;

// Escape user input before using it in a RegExp so special characters are
// matched literally (and can't throw or alter the pattern).
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pure param parser (unit-testable without Mongo). `paginated` is true when
// the caller opts in via page/limit OR any filter param — a category/tag/
// search alone must still be applied, not silently dropped by falling
// through to the legacy bare-array path.
export function parseBlogListParams(query = {}) {
  const hasCategory = typeof query.category === "string" && query.category.trim() !== "";
  const hasTag = typeof query.tag === "string" && query.tag.trim() !== "";
  const hasSearch = typeof query.search === "string" && query.search.trim() !== "";
  const paginated = query.page !== undefined || query.limit !== undefined || hasCategory || hasTag || hasSearch;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_BLOG_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_BLOG_LIMIT));
  const category = typeof query.category === "string" && query.category.trim() ? query.category.trim() : null;
  const tag = typeof query.tag === "string" && query.tag.trim() ? query.tag.trim() : null;
  const search = typeof query.search === "string" && query.search.trim() ? query.search.trim() : null;
  return { paginated, page, limit, category, tag, search };
}

// Compose the public visibility filter with the optional list filters. The
// visibility filter (buildPublicBlogFilter) is ALWAYS applied and never
// replaced. When a search is present we move the visibility $or under $and so
// the search's own $or (title/category/author) can't clobber it.
export function composePublicBlogQuery({ category, tag, search } = {}, now = new Date()) {
  const query = { ...buildPublicBlogFilter(now) };
  const extra = [];
  if (category) query.category = category; // exact match
  if (tag) query.tags = tag; // multikey array membership
  if (search) {
    const rx = new RegExp(escapeRegExp(search), "i"); // case-insensitive, same fields as the current client search
    extra.push({ $or: [{ title: rx }, { category: rx }, { author: rx }] });
  }
  if (extra.length) {
    query.$and = [{ $or: query.$or }, ...extra];
    delete query.$or;
  }
  return query;
}

export function buildPaginationMeta(total, page, limit) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

// Map a `$group` result ([{ _id: category, count }]) into the facet shape the
// listing/sidebar need: named categories with counts, nulls dropped, most
// populous first.
export function mapCategoryFacets(rows = []) {
  return rows
    .filter((r) => r && r._id)
    .map((r) => ({ name: r._id, count: r.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const getAllBlogs = async (req, res) => {
  try {
    const { paginated, page, limit, category, tag, search } = parseBlogListParams(req.query);

    // No opt-in params → unchanged historical bare-array contract.
    if (!paginated) {
      const blogs = await Blogs.find(buildPublicBlogFilter(), LIST_PROJECTION).sort({ createdAt: -1 }).lean();
      return res.json(blogs);
    }

    // ── Paginated envelope branch ──────────────────────────────────────────
    const now = new Date();
    const query = composePublicBlogQuery({ category, tag, search }, now);

    // Facets are computed over the public-visibility set only (NOT narrowed by
    // category/tag/search) so the category tabs/counts stay global — the user
    // must be able to switch between all categories, exactly as today.
    const [blogs, total, facetRows] = await Promise.all([
      Blogs.find(query, LIST_PROJECTION).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Blogs.countDocuments(query),
      Blogs.aggregate([{ $match: buildPublicBlogFilter(now) }, { $group: { _id: "$category", count: { $sum: 1 } } }]),
    ]);

    return res.json({
      blogs,
      pagination: buildPaginationMeta(total, page, limit),
      facets: { categories: mapCategoryFacets(facetRows) },
    });
  } catch (error) {
    console.error("Error fetching all blogs:", error);
    return res.status(500).json({ success: false, message: "Error fetching blogs" });
  }
};

export const getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blogs.findOne({ slug: req.params.slug, ...buildPublicBlogFilter() }).populate("authorId");
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });
    return res.json({ success: true, data: blog });
  } catch (error) {
    console.error("Error fetching blog by slug:", error);
    return res.status(500).json({ success: false, message: "Error fetching blog" });
  }
};

export const getBlog = async (req, res) => {
  try {
    const blog = await Blogs.findOne({ slug: req.params.slug, ...buildPublicBlogFilter() });
    if (!blog) {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Blog Not Found</title>
            <meta property="og:title" content="Blog Not Found" />
            <meta property="og:description" content="This blog does not exist." />
            <meta property="og:image" content="https://technohana.in/og-image.png" />
            <meta property="og:url" content="https://technohana.in/blog/${req.params.slug}" />
          </head>
          <body><div id="root"></div><script src="/main.js"></script></body>
        </html>
      `);
    }

    const cleanDesc = (blog.content || "").replace(/<\/?[^>]+(>|$)/g, "").slice(0, 150);
    const ogImage = blog.img?.startsWith("http") ? blog.img : `https://technohana.in${blog.img || "/og-image.png"}`;

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${blog.title}</title>
          <meta property="og:title" content="${blog.title}" />
          <meta property="og:description" content="${cleanDesc}..." />
          <meta property="og:image" content="${ogImage}" />
          <meta property="og:url" content="https://technohana.in/blog/${blog.slug}" />
        </head>
        <body>
          <div id="root"></div>
          <script src="/main.js"></script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Cannot fetch blog by slug:", error);
    res.status(500).send("Internal Server Error");
  }
};
