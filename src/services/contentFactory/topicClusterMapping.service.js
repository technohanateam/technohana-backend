import Course from "../../models/course.model.js";
import TopicCluster from "../../models/topicCluster.model.js";
import { callClaude, extractJson } from "../aiAgent.service.js";
import { buildSystemPrompt, buildUserPrompt } from "../../prompts/contentFactory/topicClusterProposal.prompt.js";

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Reads distinct course categories, makes ONE Claude call (tier: "cheap") to
// propose a topic-cluster grouping. Does NOT persist anything — that is
// applyTopicClusterMapping(), called only when an admin explicitly confirms.
export async function proposeTopicClusterMapping() {
  const categories = await Course.distinct("category");
  const cleanCategories = [...new Set(categories.filter(Boolean))].sort();

  if (cleanCategories.length === 0) {
    return { clusters: [], categories: [] };
  }

  const { text } = await callClaude({
    system: buildSystemPrompt(),
    prompt: buildUserPrompt({ categories: cleanCategories }),
    maxTokens: 2048,
    tier: "cheap",
  });

  const parsed = extractJson(text);
  const clusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];

  return {
    clusters: clusters.map((c) => ({
      name: String(c.name || "").slice(0, 200),
      slug: slugify(c.slug || c.name),
      description: String(c.description || "").slice(0, 500),
      categories: Array.isArray(c.categories) ? c.categories.filter(Boolean) : [],
      priority: Number.isFinite(Number(c.priority)) ? Number(c.priority) : 50,
    })),
    categories: cleanCategories,
  };
}

// Persists an admin-confirmed proposal (array of cluster objects, same shape
// as proposeTopicClusterMapping()'s output) by upserting TopicCluster docs.
export async function applyTopicClusterMapping(proposal) {
  const clusters = Array.isArray(proposal) ? proposal : proposal?.clusters;
  if (!Array.isArray(clusters) || clusters.length === 0) {
    throw new Error("proposal.clusters must be a non-empty array");
  }

  const bulkOps = clusters.map((c) => {
    const slug = slugify(c.slug || c.name);
    return {
      updateOne: {
        filter: { slug },
        update: {
          $set: {
            name: c.name,
            slug,
            description: c.description || "",
            categories: Array.isArray(c.categories) ? c.categories : [],
            priority: Number.isFinite(Number(c.priority)) ? Number(c.priority) : 50,
          },
        },
        upsert: true,
      },
    };
  });

  await TopicCluster.bulkWrite(bulkOps, { ordered: false });
  return TopicCluster.find({ slug: { $in: clusters.map((c) => slugify(c.slug || c.name)) } }).lean();
}
