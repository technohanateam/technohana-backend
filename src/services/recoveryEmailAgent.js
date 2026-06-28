import Coupon from "../models/coupon.model.js";
import { callClaude, extractJson } from "./aiAgent.service.js";
import { generateAiRecoveryEmail } from "../utils/emailTemplate.js";

// Finds at most two active coupons valid for the user's currency.
async function findRelevantCoupons(currency) {
  const coupons = await Coupon.find({ isActive: true });
  return coupons
    .filter((c) => !c.isExpired() && !c.isExhausted() && c.hasStarted() && c.isValidForCurrency(currency))
    .sort((a, b) => b.discountPercent - a.discountPercent)
    .slice(0, 2)
    .map((c) => ({ code: c.code, discountPercent: c.discountPercent, description: c.description || "" }));
}

const SYSTEM_PROMPT = `You write short, warm re-engagement emails for Technohana, a live instructor-led tech training company.
A prospective learner started an enrollment form but did not finish. Write a personalized email nudging them to complete it.

Rules:
- Tone: friendly, helpful, zero pressure. No fake urgency, no "last chance".
- Reference what they were enrolling in and how far they got, naturally.
- If coupons are provided, mention at most one, with its exact code and discount.
- Keep the body under 120 words.
- Output ONLY a JSON object: {"subject": "...", "bodyHtml": "..."}
- bodyHtml must be 2-4 <p> tags styled inline with font-size:14px;color:#64748b;line-height:1.6; plus an <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;"> greeting as the first element. Use <strong style="color:#1e293b;"> for emphasis.
- Do NOT include links, buttons, images, or scripts — the call-to-action button is added separately.`;

// Removes anything the model shouldn't have emitted before the HTML is
// slotted into the trusted email shell.
function sanitizeBodyHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(a|img|iframe|form|link|meta)\b[^>]*>/gi, "")
    .replace(/<\/(a|iframe|form)>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

// Generates a personalized recovery email for an abandoned enrollment.
// Returns { subject, html } or null — callers fall back to the static template.
// Caches the generated email on the user document for 24 h to avoid redundant API calls.
export async function generateRecoveryEmail(user) {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (
      user.aiRecoveryEmailCachedAt &&
      user.aiRecoveryEmailCachedAt > twentyFourHoursAgo &&
      user.aiRecoveryEmailSubject &&
      user.aiRecoveryEmailHtml
    ) {
      return { subject: user.aiRecoveryEmailSubject, html: user.aiRecoveryEmailHtml };
    }

    const formData = user.enrollmentFormData || {};
    const currency = formData.currency || user.currency || "INR";
    const coupons = await findRelevantCoupons(currency);

    const abandonedAt = user.enrollmentFormAbandonedAt ? new Date(user.enrollmentFormAbandonedAt) : new Date();
    const daysSince = Math.max(0, Math.floor((Date.now() - abandonedAt.getTime()) / (24 * 60 * 60 * 1000)));

    const filledFields = Object.entries(formData)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k]) => k);

    const prompt = JSON.stringify({
      learnerName: user.name || null,
      courseTitle: formData.courseTitle || user.courseTitle || null,
      trainingType: formData.trainingType || null,
      participants: formData.participants || null,
      currency,
      daysSinceAbandoned: daysSince,
      formFieldsCompleted: filledFields,
      availableCoupons: coupons,
    });

    const raw = await callClaude({ system: SYSTEM_PROMPT, prompt, maxTokens: 800 });
    const { subject, bodyHtml } = extractJson(raw);
    if (!subject || !bodyHtml) return null;

    const result = {
      subject: String(subject).slice(0, 150),
      html: generateAiRecoveryEmail({ bodyHtml: sanitizeBodyHtml(bodyHtml) }),
    };

    user.aiRecoveryEmailSubject = result.subject;
    user.aiRecoveryEmailHtml = result.html;
    user.aiRecoveryEmailCachedAt = new Date();
    await user.save();

    return result;
  } catch (err) {
    console.error("[RecoveryAgent] Falling back to static template:", err.message);
    return null;
  }
}
