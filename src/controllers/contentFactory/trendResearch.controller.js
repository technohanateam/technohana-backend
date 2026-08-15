import {
  selectManualTrendResearchClusters,
  buildManualTrendResearchPromptForCluster,
  parseManualTrendResearchResponse,
} from "../../services/contentFactory/trendResearch.service.js";

// POST /admin/content-factory/trend-research/start — selects the cluster
// queue for a manual research run (same priority/recency selection the
// cron job uses) and returns the first cluster's prompt. The client walks
// the returned `queue` (array of {clusterId, clusterName}) one at a time via
// the /step endpoint below, mirroring the bulk auto-SEO queue pattern in
// AdminBlogs.jsx.
export const startManualTrendResearch = async (req, res) => {
  try {
    const clusters = await selectManualTrendResearchClusters();
    if (clusters.length === 0) {
      return res.json({ success: true, data: { queue: [], done: true, trends: [] } });
    }
    const queue = clusters.map((c) => ({ clusterId: c._id, clusterName: c.name }));
    const { system, prompt } = await buildManualTrendResearchPromptForCluster(queue[0].clusterId);
    return res.json({
      success: true,
      data: { queue, index: 0, awaitingInput: true, prompts: [{ label: queue[0].clusterName, system, prompt }] },
    });
  } catch (err) {
    console.error("[ContentFactory] startManualTrendResearch error:", err);
    return res.status(500).json({ success: false, message: "Failed to start trend research" });
  }
};

// POST /admin/content-factory/trend-research/step — parses the admin's
// pasted response for `queue[index]`, then either returns the next
// cluster's prompt or, if that was the last cluster, the final accumulated
// trends list. `queue`/`index`/`trendsSoFar` are round-tripped from the
// client (this endpoint is stateless — no job model, mirrors the blog
// admin endpoints' pastedResponse pattern) since a queue of a few clusters
// doesn't warrant a persisted job the way multi-step content/course
// generation does.
export const submitManualTrendResearchStep = async (req, res) => {
  try {
    const { queue, index, trendsSoFar, pastedResponse } = req.body || {};
    if (!Array.isArray(queue) || typeof index !== "number" || !queue[index]) {
      return res.status(400).json({ success: false, message: "Invalid queue/index." });
    }

    const { trends } = await parseManualTrendResearchResponse(queue[index].clusterId, pastedResponse);
    const accumulated = [...(Array.isArray(trendsSoFar) ? trendsSoFar : []), ...trends];

    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      return res.json({ success: true, data: { done: true, trends: accumulated } });
    }

    const { system, prompt } = await buildManualTrendResearchPromptForCluster(queue[nextIndex].clusterId);
    return res.json({
      success: true,
      data: {
        queue,
        index: nextIndex,
        trendsSoFar: accumulated,
        awaitingInput: true,
        prompts: [{ label: queue[nextIndex].clusterName, system, prompt }],
      },
    });
  } catch (err) {
    console.error("[ContentFactory] submitManualTrendResearchStep error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to parse the pasted response." });
  }
};
