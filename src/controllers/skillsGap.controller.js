import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateSkillsGapPlanEmail } from "../utils/emailTemplate.js";
import { generateSkillsGapPdf } from "../utils/generateSkillsGapPdf.js";

export const emailSkillsGapPlan = async (req, res) => {
  try {
    const { name, email, result } = req.body;
    const currentRole = req.body.current_role || "your current role";
    const targetRole = req.body.target_role || "your target role";
    if (!email || !result || result.error) {
      // Nothing meaningful to email (analysis failed/absent) — not an error,
      // just nothing to send.
      return res.json({ success: true, data: null, message: "Nothing to email." });
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
