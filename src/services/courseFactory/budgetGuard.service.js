import { getOrCreateCourseFactorySettings } from "../../models/courseFactory/courseFactorySettings.model.js";
import { sendEmail } from "../../config/emailService.js";

// Mirrors contentFactory/budgetGuard.service.js — same shape, pointed at the
// Course Factory's own settings singleton so course-lesson generation has an
// independent daily budget from the blog Content Factory.
export function checkBudget(settings, proposedCallEstimateUsd = 0) {
  const budget = Number(settings?.dailyAiBudgetUsd) || 0;
  const spent = Number(settings?.todaySpendUsd) || 0;
  const projected = spent + (Number(proposedCallEstimateUsd) || 0);
  if (projected > budget) {
    return {
      allowed: false,
      reason: `Projected spend $${projected.toFixed(2)} would exceed the Course Factory's daily AI budget of $${budget.toFixed(2)}.`,
    };
  }
  return { allowed: true, reason: null };
}

export async function enforceBudgetOrPause(settingsIn = null) {
  const settings = settingsIn || (await getOrCreateCourseFactorySettings());
  const { allowed, reason } = checkBudget(settings, 0);
  if (allowed) return { paused: false, settings };

  if (settings.automationStatus === "PAUSED" && settings.pausedReason === "DAILY_AI_BUDGET_EXCEEDED") {
    return { paused: true, settings, alreadyPaused: true, reason };
  }

  settings.automationStatus = "PAUSED";
  settings.pausedReason = "DAILY_AI_BUDGET_EXCEEDED";
  settings.pausedAt = new Date();
  settings.budgetExceededAt = new Date();
  await settings.save();

  try {
    if (process.env.MAIL_TO) {
      await sendEmail({
        from: "Course Factory <corporate@technohana.in>",
        to: process.env.MAIL_TO,
        subject: "[Course Factory] Generation paused — daily AI budget exceeded",
        html: `<p>The AI Course Factory has automatically paused itself.</p>
<p><strong>Reason:</strong> ${reason}</p>
<p>Today's spend: $${(settings.todaySpendUsd || 0).toFixed(2)} / daily budget: $${(settings.dailyAiBudgetUsd || 0).toFixed(2)}.</p>
<p>Re-enable from the Course Factory dashboard once reviewed, or raise the daily budget in settings.</p>`,
      });
    }
  } catch (err) {
    console.error("[CourseFactory] budget-exceeded admin email failed (non-blocking):", err.message);
  }

  return { paused: true, settings, alreadyPaused: false, reason };
}

// Mirrors enforceBudgetOrPause's auto-pause pattern exactly, for a different
// trigger: a classified AUTH_FAILURE from the TTS provider (bad/expired key)
// rather than budget exhaustion. Without this, a bad key would silently keep
// failing on every subsequent lesson/course generation attempt instead of
// surfacing once and stopping.
export async function pauseForTtsAuthFailure(reasonDetail) {
  const settings = await getOrCreateCourseFactorySettings();

  if (settings.automationStatus === "PAUSED" && settings.pausedReason === "TTS_AUTH_FAILURE") {
    return { paused: true, settings, alreadyPaused: true };
  }

  settings.automationStatus = "PAUSED";
  settings.pausedReason = "TTS_AUTH_FAILURE";
  settings.pausedAt = new Date();
  await settings.save();

  try {
    if (process.env.MAIL_TO) {
      await sendEmail({
        from: "Course Factory <corporate@technohana.in>",
        to: process.env.MAIL_TO,
        subject: "[Course Factory] Generation paused — TTS authentication failure",
        html: `<p>The AI Course Factory has automatically paused itself.</p>
<p><strong>Reason:</strong> The configured TTS provider rejected the API key (authentication failure).</p>
<p>${reasonDetail || ""}</p>
<p>Check the TTS provider API key, then re-enable from the Course Factory dashboard.</p>`,
      });
    }
  } catch (err) {
    console.error("[CourseFactory] TTS-auth-failure admin email failed (non-blocking):", err.message);
  }

  return { paused: true, settings, alreadyPaused: false };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const COST_PER_1K_TOKENS = {
  "claude-sonnet-4-6": { in: 0.003, out: 0.015 },
  "claude-haiku-4-5-20251001": { in: 0.0008, out: 0.004 },
  "claude-sonnet-5": { in: 0.003, out: 0.015 },
};

export function estimateCostUsd(model, tokensIn, tokensOut) {
  const rates = COST_PER_1K_TOKENS[model] || COST_PER_1K_TOKENS["claude-sonnet-5"];
  return (tokensIn / 1000) * rates.in + (tokensOut / 1000) * rates.out;
}

// Rolls today's spend forward on the Course Factory settings singleton —
// called after every tracked Claude/TTS call in this pipeline.
export async function recordCourseFactorySpend(estimatedCostUsd) {
  try {
    const settings = await getOrCreateCourseFactorySettings();
    const today = todayStr();
    if (settings.todaySpendDate !== today) {
      settings.todaySpendUsd = 0;
      settings.todaySpendDate = today;
    }
    settings.todaySpendUsd = (settings.todaySpendUsd || 0) + estimatedCostUsd;
    await settings.save();
  } catch (err) {
    console.error("[CourseFactory] recordCourseFactorySpend failed (non-blocking):", err.message);
  }
}
