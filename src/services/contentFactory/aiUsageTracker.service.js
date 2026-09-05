import { callClaude } from "../aiAgent.service.js";
import AiUsageLog from "../../models/aiUsageLog.model.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";

// Rough $/1K-token estimate table — approximate public pricing, NOT exact
// billing, good enough for the budget-tracking UI. Mirrors the table in
// contentGenerationOrchestrator.service.js (kept separate there for that
// module's own per-step job-ledger costing — update both if pricing changes).
const COST_PER_1K_TOKENS = {
  "claude-sonnet-4-6": { in: 0.003, out: 0.015 },
  "claude-haiku-4-5-20251001": { in: 0.0008, out: 0.004 },
  "claude-sonnet-5": { in: 0.003, out: 0.015 },
};

function estimateCostUsd(model, tokensIn, tokensOut) {
  const rates = COST_PER_1K_TOKENS[model] || COST_PER_1K_TOKENS["claude-sonnet-5"];
  return (tokensIn / 1000) * rates.in + (tokensOut / 1000) * rates.out;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Non-blocking accounting: writes an AiUsageLog row and rolls
// ContentFactorySettings.todaySpendUsd forward (resetting it first if the
// stored todaySpendDate isn't today). Wrapped in try/catch so a logging
// failure can never break the caller's actual AI-call result.
export async function recordAiUsage({ model, tier = null, tokensIn = 0, tokensOut = 0, callType, opportunityId = null, jobId = null }) {
  try {
    const estimatedCostUsd = estimateCostUsd(model, tokensIn, tokensOut);

    await AiUsageLog.create({
      date: todayStr(),
      callType: callType || "unknown",
      model: model || null,
      tier,
      tokensIn,
      tokensOut,
      estimatedCostUsd,
      opportunityId: opportunityId || null,
      jobId: jobId || null,
    });

    const settings = await getOrCreateContentFactorySettings();
    const today = todayStr();
    if (settings.todaySpendDate !== today) {
      settings.todaySpendUsd = 0;
      settings.todaySpendDate = today;
    }
    settings.todaySpendUsd = (settings.todaySpendUsd || 0) + estimatedCostUsd;
    await settings.save();

    return estimatedCostUsd;
  } catch (err) {
    console.error("[ContentFactory] recordAiUsage failed (non-blocking):", err.message);
    return 0;
  }
}

// Drop-in wrapper for aiAgent.service.js's callClaude() — same signature plus
// callType/opportunityId/jobId, same { text, usage, model } return shape, so
// call sites only need their import + call name changed. This is THE call
// site every simple-shape Claude call in src/services/contentFactory/**
// should route through (see AI_CONTENT_FACTORY_IMPLEMENTATION.md Milestone 4).
export async function trackedCallClaude({ system, prompt, maxTokens = 1024, tier = "standard", callType, opportunityId = null, jobId = null }) {
  const result = await callClaude({ system, prompt, maxTokens, tier });
  const tokensIn = result.usage?.input_tokens || 0;
  const tokensOut = result.usage?.output_tokens || 0;
  await recordAiUsage({ model: result.model, tier, tokensIn, tokensOut, callType, opportunityId, jobId });
  return result;
}
