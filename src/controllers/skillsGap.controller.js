import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateSkillsGapPlanEmail } from "../utils/emailTemplate.js";
import { generateSkillsGapPdf } from "../utils/generateSkillsGapPdf.js";

export const emailSkillsGapPlan = async (req, res) => {
  try {
    const { name, email, current_role, target_role, result } = req.body;
    if (!email || !result || result.error) {
      // Nothing meaningful to email (analysis failed/absent) — not an error,
      // just nothing to send.
      return res.json({ success: true, message: "Nothing to email." });
    }

    const pdfBuffer = await generateSkillsGapPdf({
      name,
      currentRole: current_role,
      targetRole: target_role,
      summary: result.summary,
      skillGaps: result.skillGaps,
      recommendedCourses: result.recommendedCourses,
      timeline: result.timeline,
      totalCost: result.totalCost,
      nextStep: result.nextStep,
    });

    await sendEmail({
      from: fromAddresses.sales,
      to: email,
      subject: `Your Learning Path: ${current_role} → ${target_role}`,
      html: generateSkillsGapPlanEmail({ name, currentRole: current_role, targetRole: target_role, summary: result.summary }),
      attachments: [{ filename: "technohana-learning-path.pdf", content: pdfBuffer }],
    });

    return res.json({ success: true, message: "Plan emailed." });
  } catch (err) {
    console.error("emailSkillsGapPlan error:", err);
    return res.status(500).json({ success: false, message: "Failed to email plan." });
  }
};
