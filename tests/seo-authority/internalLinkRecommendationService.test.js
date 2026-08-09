import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Blogs } from "../../src/models/blogs.model.js";
import Course from "../../src/models/course.model.js";
import SeoTopicCluster from "../../src/models/seoTopicCluster.model.js";
import { getRecommendationsForBlog, getRecommendationsForCourse } from "../../src/services/internalLinkRecommendationService.js";

beforeEach(() => {
  mock.restoreAll();
});

test("getRecommendationsForBlog returns null when the source blog doesn't exist", async () => {
  mock.method(Blogs, "findById", () => ({ lean: async () => null }));
  const result = await getRecommendationsForBlog("missing-id");
  assert.equal(result, null);
});

test("getRecommendationsForBlog scores shared-cluster blogs highest and surfaces the reason", async () => {
  const source = { _id: "src1", title: "Generative AI Guide", category: "AI", tags: ["genai", "llm"] };
  mock.method(Blogs, "findById", () => ({ lean: async () => source }));
  mock.method(SeoTopicCluster, "find", () => ({
    lean: async () => [{ blogIds: ["src1", "sibling1"], courseIds: ["FDA001"] }],
  }));
  mock.method(Blogs, "find", () => ({
    limit: () => ({
      lean: async () => [
        { _id: "sibling1", title: "Agentic AI Basics", category: "AI", tags: ["genai"], contentType: "search-article" },
        { _id: "unrelated1", title: "Payroll Tips", category: "HR", tags: ["payroll"], contentType: "search-article" },
      ],
    }),
  }));
  mock.method(Course, "find", () => ({ limit: () => ({ lean: async () => [] }) }));

  const result = await getRecommendationsForBlog("src1");

  assert.equal(result.relatedBlogs.length, 1);
  assert.equal(result.relatedBlogs[0].blogId, "sibling1");
  assert.ok(result.relatedBlogs[0].reasons.includes("shared topic cluster"));
  assert.ok(result.relatedBlogs[0].score >= 100);
});

test("getRecommendationsForBlog boosts linkable-asset content type as a link target", async () => {
  const source = { _id: "src1", title: "Cloud Guide", category: "Cloud", tags: ["cloud"] };
  mock.method(Blogs, "findById", () => ({ lean: async () => source }));
  mock.method(SeoTopicCluster, "find", () => ({ lean: async () => [] }));
  mock.method(Blogs, "find", () => ({
    limit: () => ({
      lean: async () => [
        { _id: "asset1", title: "Cloud Skills Matrix", category: "Cloud", tags: ["cloud"], contentType: "linkable-asset" },
      ],
    }),
  }));
  mock.method(Course, "find", () => ({ limit: () => ({ lean: async () => [] }) }));

  const result = await getRecommendationsForBlog("src1");
  assert.equal(result.relatedBlogs.length, 1);
  assert.ok(result.relatedBlogs[0].reasons.includes("linkable asset"));
});

test("getRecommendationsForCourse returns null for an unknown course id", async () => {
  mock.method(Course, "findOne", () => ({ lean: async () => null }));
  const result = await getRecommendationsForCourse("NOPE001");
  assert.equal(result, null);
});

test("getRecommendationsForCourse surfaces category-matched blogs", async () => {
  mock.method(Course, "findOne", () => ({ lean: async () => ({ id: "FDA001", courseTitle: "Generative AI Foundations", category: "AI" }) }));
  mock.method(SeoTopicCluster, "find", () => ({ lean: async () => [] }));
  mock.method(Blogs, "find", () => ({
    limit: () => ({
      lean: async () => [
        { _id: "b1", title: "AI Careers", category: "AI", tags: ["ai"], contentType: "search-article" },
      ],
    }),
  }));

  const result = await getRecommendationsForCourse("FDA001");
  assert.equal(result.relatedBlogs.length, 1);
  assert.ok(result.relatedBlogs[0].reasons.includes("same category"));
});
