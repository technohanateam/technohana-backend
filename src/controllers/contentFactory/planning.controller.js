import { enqueuePlanningRunNow } from "../../services/contentFactory/contentFactoryQueue.js";

// POST /admin/content-factory/plan/run-now — enqueues the real daily planning
// job immediately via contentFactoryQueue, without waiting for the 05:00 cron.
// Still runs the exact same PAUSED/budget-guarded sequence as the cron
// (dailyPlanningJob.processor.js) — this is the REAL run, distinct from
// /plan/dry-run (never touches Blogs/generation) — possibly including
// auto-generation if settings.autoGenerateArticles is true, in which case
// generated articles still always land in human review, never auto-published.
export const runPlanningNow = async (req, res) => {
  try {
    const job = await enqueuePlanningRunNow();
    return res.json({ success: true, data: { jobId: job.id }, message: "Planning job enqueued" });
  } catch (err) {
    console.error("[ContentFactory] runPlanningNow error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
