import { Blogs } from "../models/blogs.model.js";
import Course from "../models/course.model.js";
import SeoTopicCluster from "../models/seoTopicCluster.model.js";

const MAX_RESULTS = 10;

const normalize = (str) => (str || "").toLowerCase().trim();

const tagOverlapCount = (tagsA = [], tagsB = []) => {
  const setB = new Set(tagsB.map(normalize));
  return tagsA.map(normalize).filter((tag) => tag && setB.has(tag)).length;
};

const scoreBlogAgainstBlog = (source, candidate, sharedClusterBlogIds) => {
  let score = 0;
  const reasons = [];

  if (sharedClusterBlogIds.has(candidate._id.toString())) {
    score += 100;
    reasons.push("shared topic cluster");
  }

  const overlap = tagOverlapCount(source.tags, candidate.tags);
  if (overlap > 0) {
    score += overlap * 20;
    reasons.push(`${overlap} shared tag${overlap > 1 ? "s" : ""}`);
  }

  if (normalize(source.category) && normalize(source.category) === normalize(candidate.category)) {
    score += 25;
    reasons.push("same category");
  }

  if (candidate.contentType === "linkable-asset") {
    score += 15;
    reasons.push("linkable asset");
  }

  return { score, reasons };
};

const scoreCourseAgainstBlog = (blog, course, sharedClusterCourseIds) => {
  let score = 0;
  const reasons = [];

  if (sharedClusterCourseIds.has(course.id)) {
    score += 100;
    reasons.push("shared topic cluster");
  }

  const blogTags = (blog.tags || []).map(normalize);
  const courseNeedle = normalize(course.courseTitle);
  if (courseNeedle && blogTags.some((tag) => tag && (courseNeedle.includes(tag) || tag.includes(courseNeedle)))) {
    score += 40;
    reasons.push("tag/title overlap");
  }

  if (normalize(blog.category) && normalize(course.category) && normalize(blog.category).includes(normalize(course.category))) {
    score += 25;
    reasons.push("same category");
  }

  return { score, reasons };
};

// Finds every topic cluster containing the given blog/course, and returns
// the union of "sibling" ids in each — the basis for the +100 "shared
// cluster" score used by both recommendation directions below.
const getClusterSiblings = async ({ blogId, courseId }) => {
  const filter = blogId ? { blogIds: blogId } : { courseIds: courseId };
  const clusters = await SeoTopicCluster.find(filter).lean();
  const blogIds = new Set();
  const courseIds = new Set();
  for (const cluster of clusters) {
    (cluster.blogIds || []).forEach((id) => blogIds.add(id.toString()));
    (cluster.courseIds || []).forEach((id) => courseIds.add(id));
  }
  if (blogId) blogIds.delete(blogId.toString());
  if (courseId) courseIds.delete(courseId);
  return { blogIds, courseIds };
};

export const getRecommendationsForBlog = async (blogId) => {
  const source = await Blogs.findById(blogId).lean();
  if (!source) return null;

  const { blogIds: siblingBlogIds, courseIds: siblingCourseIds } = await getClusterSiblings({ blogId });

  const candidateBlogs = await Blogs.find(
    { _id: { $ne: source._id }, published: true },
    { title: 1, slug: 1, category: 1, tags: 1, contentType: 1 }
  )
    .limit(500)
    .lean();

  const relatedBlogs = candidateBlogs
    .map((candidate) => ({ candidate, ...scoreBlogAgainstBlog(source, candidate, siblingBlogIds) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ candidate, score, reasons }) => ({
      type: "blog",
      blogId: candidate._id,
      title: candidate.title,
      slug: candidate.slug,
      score,
      reasons,
    }));

  const candidateCourses = await Course.find(
    {},
    { id: 1, courseTitle: 1, category: 1 }
  )
    .limit(500)
    .lean();

  const relatedCourses = candidateCourses
    .map((course) => ({ course, ...scoreCourseAgainstBlog(source, course, siblingCourseIds) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ course, score, reasons }) => ({
      type: "course",
      courseId: course.id,
      title: course.courseTitle,
      score,
      reasons,
    }));

  return { relatedBlogs, relatedCourses };
};

export const getRecommendationsForCourse = async (courseId) => {
  const course = await Course.findOne({ id: courseId }).lean();
  if (!course) return null;

  const { blogIds: siblingBlogIds } = await getClusterSiblings({ courseId });

  const candidateBlogs = await Blogs.find(
    { published: true },
    { title: 1, slug: 1, category: 1, tags: 1, contentType: 1 }
  )
    .limit(500)
    .lean();

  const relatedBlogs = candidateBlogs
    .map((blog) => {
      let score = 0;
      const reasons = [];
      if (siblingBlogIds.has(blog._id.toString())) {
        score += 100;
        reasons.push("shared topic cluster");
      }
      const courseNeedle = normalize(course.courseTitle);
      const blogTags = (blog.tags || []).map(normalize);
      if (courseNeedle && blogTags.some((tag) => tag && (courseNeedle.includes(tag) || tag.includes(courseNeedle)))) {
        score += 40;
        reasons.push("tag/title overlap");
      }
      if (normalize(blog.category) && normalize(course.category) && normalize(blog.category).includes(normalize(course.category))) {
        score += 25;
        reasons.push("same category");
      }
      if (blog.contentType === "linkable-asset") {
        score += 15;
        reasons.push("linkable asset");
      }
      return { blog, score, reasons };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ blog, score, reasons }) => ({
      type: "blog",
      blogId: blog._id,
      title: blog.title,
      slug: blog.slug,
      score,
      reasons,
    }));

  return { relatedBlogs };
};
