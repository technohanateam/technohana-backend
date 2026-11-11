import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateSkillsGapPlanEmail } from "../utils/emailTemplate.js";
import { generateSkillsGapPdf } from "../utils/generateSkillsGapPdf.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { BEFORE_SKILL_GAP, logStatusChange } from "./crmCourse.controller.js";

// A lead who opened their personal Skills Gap link (?cl=token) and submitted: attach the
// result to that lead, move the pipeline forward and log it. Never blocks the plan email.
const recordCrmSubmission = async (token, { currentRole, targetRole, currency, result }) => {
  if (typeof token !== "string" || token.length < 10 || token.length > 100) return;
  const lead = await CRMLead.findOne({ publicToken: token, isDeleted: false }).select("status").lean();
  if (!lead) return;

  const update = { skillGapData: { currentRole, targetRole, currency, analysis: result, analyzedAt: new Date(), source: "lead_form" } };
  const advance = BEFORE_SKILL_GAP.includes(lead.status);
  if (advance) update.status = "skill_gap_assessed";
  await CRMLead.updateOne({ _id: lead._id }, { $set: update });

  await CRMActivity.create({
    type: "form_submitted", title: "Completed Skills Gap form",
    body: `Lead completed the Skills Gap tool: ${currentRole} → ${targetRole}`,
    relatedToType: "lead", relatedToId: lead._id, metadata: { form: "skills_gap", currentRole, targetRole },
  });
  if (advance) await logStatusChange(lead._id, lead.status, "skill_gap_assessed", undefined, "lead completed Skills Gap form");
};

export const emailSkillsGapPlan = async (req, res) => {
  try {
    const { name, email, result } = req.body;
    const currentRole = req.body.current_role || "your current role";
    const targetRole = req.body.target_role || "your target role";
    const validCurrencies = ["inr", "usd", "aed"];
    const currency = validCurrencies.includes(req.body.currency) ? req.body.currency : "inr";
    if (!email || !result || result.error) {
      // Nothing meaningful to email (analysis failed/absent) — not an error,
      // just nothing to send.
      return res.json({ success: true, data: null, message: "Nothing to email." });
    }

    if (req.body.crmToken) {
      await recordCrmSubmission(req.body.crmToken, { currentRole: String(currentRole).slice(0, 100), targetRole: String(targetRole).slice(0, 100), currency, result })
        .catch((e) => console.error("CRM skills-gap link recording failed:", e.message));
    }

    const pdfBuffer = await generateSkillsGapPdf({
      name,
      currentRole,
      targetRole,
      summary: result.summary,
      skillGaps: result.skillGaps,
      recommendedCourses: result.recommendedCourses,
      timeline: result.timeline,
      totalCost: result.totalCost,
      nextStep: result.nextStep,
      currency,
    });

    await sendEmail({
      from: fromAddresses.sales,
      to: email,
      subject: `Your Learning Path: ${currentRole} → ${targetRole}`,
      html: generateSkillsGapPlanEmail({ name, currentRole, targetRole, summary: result.summary }),
      attachments: [{ filename: "technohana-learning-path.pdf", content: pdfBuffer }],
    });

    return res.json({ success: true, data: null, message: "Plan emailed." });
  } catch (err) {
    console.error("emailSkillsGapPlan error:", err);
    return res.status(500).json({ success: false, message: "Failed to email plan." });
  }
};
