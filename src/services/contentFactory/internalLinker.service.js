import Course from "../../models/course.model.js";
import { Blogs } from "../../models/blogs.model.js";
import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildInternalLinkerPrompt } from "../../prompts/contentFactory/internalLinker.prompt.js";

const MAX_COURSE_LINKS = 5;
const MIN_COURSE_LINKS = 2;
const MAX_BLOG_LINKS = 4;
const MIN_BLOG_LINKS = 1;

// Builds real candidate pools: prefer the brief's suggested slugs/ids where
// they resolve to a real record, then fall back to same-category matches so
// there's always something to validate against. Returns both the prompt (if
// there are candidates to choose from) and the candidate pools themselves,
// since parseInternalLinksResponse needs the exact same pools to validate
// against — never trust the AI, every suggested course/blog is checked
// against the real, currently-existing catalog before being included.
export async function buildInternalLinkerPromptForOpportunity(articleDraft, brief, opportunity) {
  const suggestedCourseSlugs = (brief?.internalLinkTargets?.courses || []).map((c) => c.courseSlug).filter(Boolean);
  const suggestedBlogIds = (brief?.internalLinkTargets?.blogs || []).map((b) => b.blogId).filter(Boolean);

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

  if (!candidateCourses.length && !candidateBlogs.length) {
    return { prompt: null, candidateCourses, candidateBlogs };
  }

  const prompt = buildInternalLinkerPrompt({
    articleDraft,
    candidateCourses: candidateCourses.map((c) => ({ courseSlug: c.courseSlug || c.id, courseTitle: c.courseTitle })),
    candidateBlogs,
  });

  return { prompt, candidateCourses, candidateBlogs };
}

// Parses a manually-pasted Claude Pro response (or, if there were no
// candidates to choose from / nothing was pasted, an empty choice) and
// validates every chosen link against the real candidate pool before
// building the final content + suggestedInternalLinks.
export function parseInternalLinksResponse(text, articleDraft, candidateCourses, candidateBlogs) {
  let chosen = { courses: [], blogs: [] };
  if (text) {
    try {
      chosen = parseModelJson(text) || { courses: [], blogs: [] };
    } catch {
      chosen = { courses: [], blogs: [] };
    }
  }

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
    // courseLinks[].courseSlug is always populated from candidate.id (see the
    // .map() above, which uses `course.id` as the href slug) — match against
    // the same field here so an already-included candidate isn't duplicated.
    const used = new Set(courseLinks.map((c) => c.courseSlug));
    for (const c of candidateCourses) {
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

  return { suggestedInternalLinks, content };
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
