import Course from "../../models/course.model.js";
import { Blogs } from "../../models/blogs.model.js";
import { trackedCallClaude } from "./aiUsageTracker.service.js";
import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildInternalLinkerPrompt } from "../../prompts/contentFactory/internalLinker.prompt.js";

const MAX_COURSE_LINKS = 5;
const MIN_COURSE_LINKS = 2;
const MAX_BLOG_LINKS = 4;
const MIN_BLOG_LINKS = 1;

// Uses brief.internalLinkTargets as candidates but NEVER trusts them —
// every suggested course/blog is checked against the real, currently-existing
// catalog before being included. Returns suggestedInternalLinks plus a
// content HTML string with a small "Recommended Technohana Courses" section
// appended (mirrors the spirit of AdminBlogs.jsx's appendCourseLinksSection,
// re-implemented server-side rather than importing frontend JS into the
// backend).
export async function generateInternalLinks(articleDraft, brief, opportunity) {
  // Build real candidate pools: prefer the brief's suggested slugs/ids where
  // they resolve to a real record, then fall back to same-category matches
  // so there's always something to validate against.
  const suggestedCourseSlugs = (brief?.internalLinkTargets?.courses || []).map((c) => c.courseSlug).filter(Boolean);
  const suggestedBlogIds = (brief?.internalLinkTargets?.blogs || []).map((b) => b.blogId).filter(Boolean);

  // Category-scoped fallback only runs when there IS a category to scope
  // by — an unfiltered Course.find({})/Blogs.find({}) would hand back "any
  // 10 records in the collection" as link candidates, which is worse than no
  // fallback at all (irrelevant recommendations inserted into the article).
  const [bySlug, byCategory] = await Promise.all([
    suggestedCourseSlugs.length
      ? Course.find({ $or: [{ courseSlug: { $in: suggestedCourseSlugs } }, { id: { $in: suggestedCourseSlugs } }] })
          .select("id courseSlug courseTitle category")
          .limit(10)
          .lean()
      : Promise.resolve([]),
    opportunity?.category
      ? Course.find({ category: opportunity.category }).select("id courseSlug courseTitle category").limit(10).lean()
      : Promise.resolve([]),
  ]);
  const courseCandidatesMap = new Map();
  [...bySlug, ...byCategory].forEach((c) => courseCandidatesMap.set(String(c._id), c));
  const candidateCourses = Array.from(courseCandidatesMap.values()).slice(0, 10);

  const [blogsById, blogsByCategory] = await Promise.all([
    suggestedBlogIds.length ? Blogs.find({ _id: { $in: suggestedBlogIds.filter((id) => /^[a-f\d]{24}$/i.test(id)) } }).select("_id title slug category").limit(10).lean() : Promise.resolve([]),
    opportunity?.category
      ? Blogs.find({ category: opportunity.category }).select("_id title slug category").limit(10).lean()
      : Promise.resolve([]),
  ]);
  const blogCandidatesMap = new Map();
  [...blogsById, ...blogsByCategory].forEach((b) => blogCandidatesMap.set(String(b._id), b));
  const candidateBlogs = Array.from(blogCandidatesMap.values())
    .slice(0, 10)
    .map((b) => ({ id: String(b._id), title: b.title, slug: b.slug }));

  let usage = null;
  let model = null;
  let chosen = { courses: [], blogs: [] };

  if (candidateCourses.length || candidateBlogs.length) {
    try {
      const { system, prompt } = buildInternalLinkerPrompt({
        articleDraft,
        candidateCourses: candidateCourses.map((c) => ({ courseSlug: c.courseSlug || c.id, courseTitle: c.courseTitle })),
        candidateBlogs,
      });
      const result = await trackedCallClaude({ system, prompt, maxTokens: 768, tier: "cheap", callType: "links", opportunityId: opportunity?._id || null });
      usage = result.usage;
      model = result.model;
      chosen = parseModelJson(result.text) || { courses: [], blogs: [] };
    } catch {
      chosen = { courses: [], blogs: [] };
    }
  }

  // Validate every AI-chosen link against the real candidate pool — never
  // emit a URL for a course/blog that doesn't actually exist.
  const validCourseKeys = new Set(candidateCourses.map((c) => c.courseSlug || c.id));
  const courseBySlugOrId = new Map(candidateCourses.map((c) => [c.courseSlug || c.id, c]));
  let courseLinks = (chosen.courses || [])
    .filter((c) => validCourseKeys.has(c.courseSlug))
    .map((c) => {
      const course = courseBySlugOrId.get(c.courseSlug);
      return { courseSlug: course.id, anchorText: c.anchorText || course.courseTitle, reason: c.reason || "Related course" };
    });

  const validBlogIds = new Set(candidateBlogs.map((b) => b.id));
  const blogById = new Map(candidateBlogs.map((b) => [b.id, b]));
  let blogLinks = (chosen.blogs || [])
    .filter((b) => validBlogIds.has(b.blogId))
    .map((b) => {
      const blog = blogById.get(b.blogId);
      return { blogId: blog.id, anchorText: b.anchorText || blog.title, reason: b.reason || "Related post" };
    });

  // Fill/trim to target ranges from validated candidates if the AI under- or
  // over-selected — proportional to article length is a soft goal, the hard
  // rule is "never invent a link".
  if (courseLinks.length < MIN_COURSE_LINKS) {
    const used = new Set(courseLinks.map((c) => c.courseSlug));
    for (const c of candidateCourses) {
      const key = c.courseSlug || c.id;
      if (used.has(c.id)) continue;
      courseLinks.push({ courseSlug: c.id, anchorText: c.courseTitle, reason: "Related course" });
      used.add(c.id);
      if (courseLinks.length >= MIN_COURSE_LINKS) break;
    }
  }
  courseLinks = courseLinks.slice(0, MAX_COURSE_LINKS);

  if (blogLinks.length < MIN_BLOG_LINKS) {
    const used = new Set(blogLinks.map((b) => b.blogId));
    for (const b of candidateBlogs) {
      if (used.has(b.id)) continue;
      blogLinks.push({ blogId: b.id, anchorText: b.title, reason: "Related post" });
      used.add(b.id);
      if (blogLinks.length >= MIN_BLOG_LINKS) break;
    }
  }
  blogLinks = blogLinks.slice(0, MAX_BLOG_LINKS);

  const suggestedInternalLinks = { courses: courseLinks, blogs: blogLinks };

  const content = appendRecommendedCoursesSection(articleDraft.content, courseLinks);

  return { suggestedInternalLinks, content, usage, model };
}

function appendRecommendedCoursesSection(html, courseLinks) {
  if (!html || !courseLinks.length) return html;
  if (/href=["']\/courses\//i.test(html)) return html; // already has course links inline

  const items = courseLinks.map((c) => `<li><a href="/courses/${c.courseSlug}">${c.anchorText}</a></li>`).join("");
  return `${html}

<h2>Recommended Technohana Courses</h2>
<p>Explore these related courses to keep building practical skills:</p>
<ul>${items}</ul>`;
}
