import User from "../models/user.model.js";
import { callClaude } from "./aiAgent.service.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";

// Agent 3 — Churn / At-Risk Learner
// Scans active enrollments for users who haven't logged in for 14+ days
// and sends personalized nudge emails via Resend.

const INACTIVE_DAYS = 14;

export async function runAtRiskScan() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INACTIVE_DAYS);

  let processed = 0;
  let nudged = 0;

  try {
    // Find active enrolled users who haven't been seen recently
    const users = await User.find({
      enrollmentStatus: { $in: ["active", "enrolled"] },
      lastAccessedAt: { $lt: cutoff, $exists: true },
    })
      .select("name email lastAccessedAt enrollmentProgress courseTitle batchStartDate")
      .limit(200)
      .lean();

    for (const user of users) {
      processed++;
      try {
        const daysSince = Math.floor((Date.now() - new Date(user.lastAccessedAt).getTime()) / 86400000);
        const progress  = user.enrollmentProgress ?? 0;

        const prompt = `You are a learning coach for TechnoHana, an AI training company.
A learner has been inactive for ${daysSince} days.

Learner: ${user.name}
Course: ${user.courseTitle || "AI Training Course"}
Progress: ${progress}% complete
Last active: ${daysSince} days ago

Write a short, warm, motivational email nudge to re-engage them (under 120 words).
Focus on their progress and what they will gain by continuing.
Do NOT mention discounts or prices.

Respond ONLY with JSON: {"subject": "...", "body": "..."}`;

        const raw = await callClaude({
          system: "You are a friendly learning coach. Respond only with valid JSON.",
          prompt,
          maxTokens: 300,
        });

        let parsed;
        try {
          const match = raw.match(/\{[\s\S]*\}/);
          parsed = JSON.parse(match?.[0] || raw);
        } catch {
          continue;
        }

        if (!parsed?.subject || !parsed?.body) continue;

        await sendEmail({
          from: fromAddresses.connect,
          to: user.email,
          subject: parsed.subject,
          html: `<p>${parsed.body.replace(/\n/g, "</p><p>")}</p>`,
        });

        nudged++;
      } catch (err) {
        console.error(`[AtRiskAgent] Failed for user ${user._id}:`, err.message);
      }
    }

    console.log(`[AtRiskAgent] Scanned ${processed} users, nudged ${nudged}`);
    return { processed, nudged };
  } catch (err) {
    console.error("[AtRiskAgent] Scan failed:", err.message);
    return { processed, nudged, error: err.message };
  }
}
