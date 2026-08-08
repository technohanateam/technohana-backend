// Prompt module for topicClusterMapping.service.js — proposes a topic-cluster
// grouping of the course catalog's distinct categories. Never persisted by
// this prompt/service; the controller's applyMapping step does that only
// after explicit admin confirmation.

export function buildSystemPrompt() {
  return `You are a content strategist for Technohana, a live instructor-led tech training company. You group course categories into a small number of coherent topic clusters used to plan a blog content calendar. Clusters should be broad enough to be reusable (e.g. "AI & GenAI", "Cloud & DevOps", "Data & Analytics", "Cybersecurity", "Business & Agile", "Project Management") but specific enough to be useful for SEO topical authority. Output ONLY valid JSON, no prose.`;
}

export function buildUserPrompt({ categories = [] } = {}) {
  return `Here are the distinct course categories from our catalog:
${categories.map((c) => `- ${c}`).join("\n")}

Group these categories into topic clusters. Every category must be assigned to exactly one cluster. Aim for roughly 4-10 clusters total.

Respond with ONLY this JSON shape:
{
  "clusters": [
    {
      "name": "Cluster display name",
      "slug": "url-safe-slug",
      "description": "One sentence describing the cluster's scope",
      "categories": ["Category A", "Category B"],
      "priority": 50
    }
  ]
}`;
}

export const responseSchema = {
  clusters: [{ name: "string", slug: "string", description: "string", categories: ["string"], priority: "number" }],
};
