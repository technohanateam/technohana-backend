import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";
import { sendEmail } from "../../config/emailService.js";

// PURE — no DB/network. `settings` is a plain object (or mongoose doc, read
// only) with todaySpendUsd/dailyAiBudgetUsd; `proposedCallEstimateUsd` is a
// number (0 to just check current spend against budget). Trivially
// unit-testable with plain objects.
export function checkBudget(settings, proposedCallEstimateUsd = 0) {
  const budget = Number(settings?.dailyAiBudgetUsd) || 0;
  const spent = Number(settings?.todaySpendUsd) || 0;
  const projected = spent + (Number(proposedCallEstimateUsd) || 0);
  if (projected > budget) {
    return {
      allowed: false,
      reason: `Projected spend $${projected.toFixed(2)} would exceed the daily AI budget of $${budget.toFixed(2)}.`,
    };
  }
  return { allowed: true, reason: null };
}

// DB-touching. Pass an existing settings doc if you already have one loaded
// in this run (so the check reflects the freshest todaySpendUsd); otherwise
// it loads the singleton itself. Safe to call repeatedly during one run —
// once already PAUSED for this exact reason it no-ops (won't re-send the
// admin email every time it's re-checked mid-run).
export async function enforceBudgetOrPause(settingsIn = null) {
  const settings = settingsIn || (await getOrCreateContentFactorySettings());
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
        from: "Content Factory <corporate@technohana.in>",
        to: process.env.MAIL_TO,
        subject: "[Content Factory] Automation paused — daily AI budget exceeded",
        html: `<p>The AI Content Factory has automatically paused itself.</p>
<p><strong>Reason:</strong> ${reason}</p>
<p>Today's spend: $${(settings.todaySpendUsd || 0).toFixed(2)} / daily budget: $${(settings.dailyAiBudgetUsd || 0).toFixed(2)}.</p>
<p>Re-enable automation from the Content Factory dashboard once you've reviewed spend, or raise the daily budget in settings.</p>`,
      });
    }
  } catch (err) {
    console.error("[ContentFactory] budget-exceeded admin email failed (non-blocking):", err.message);
  }

  return { paused: true, settings, alreadyPaused: false, reason };
}
