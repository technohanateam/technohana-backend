import Enquiry from "../models/enquiry.model.js";
import AiRiskReport from "../models/aiRiskReport.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateEnquiryTable, generateEnquiryConfirmationEmail, generateContactUsEmail, generateAiRiskReportEmail } from "../utils/emailTemplate.js";

export const createEnquiry = async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.message   && !body.description)  body.description  = body.message;
    if (body.type      && !body.enquiryType)   body.enquiryType  = body.type;
    if (body.organization && !body.company)    body.company      = body.organization;
    if (body.courseInterest && !body.courseTitle) body.courseTitle = body.courseInterest;
    delete body.message; delete body.type; delete body.organization; delete body.courseInterest;

    const { name, email, courseTitle, enquiryType, selectedPackage, timeline } = body;

    const enquiry = new Enquiry(body);
    await enquiry.save();

    let subject;
    switch (enquiryType) {
      case "Quote Request":
        subject = `New Quote Request for: ${courseTitle}`;
        break;
      case "Syllabus Download":
        subject = `Syllabus Downloaded for: ${courseTitle}`;
        break;
      case "AI Agent Build":
        subject = `New AI Agent Build Request${selectedPackage ? ` — ${selectedPackage} package` : ""}`;
        break;
      case "General Enquiry":
      default:
        subject = `New General Enquiry for: ${courseTitle}`;
        break;
    }

    // Admin notification + user confirmation in parallel (non-blocking on user email failure)
    await sendEmail({
      from: fromAddresses.sales,
      to: process.env.MAIL_TO,
      subject,
      html: generateEnquiryTable(req.body),
    });

    sendEmail({
      from: fromAddresses.sales,
      to: email,
      subject: `We received your request — Technohana will be in touch within 24 hours`,
      html: generateEnquiryConfirmationEmail({ name, enquiryType, courseTitle, selectedPackage, timeline }),
    }).catch((err) => console.error("Enquiry confirmation email failed (lead already saved):", err));

    res
      .status(201)
      .json({ message: "Enquiry submitted and email sent successfully." });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

export const contactUs = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const enquiry = new Enquiry({ name, email, phone, enquiryType: "Contact Us", courseTitle: subject, description: message });
    await enquiry.save();

    await sendEmail({
      from: fromAddresses.connect,
      to: process.env.MAIL_TO,
      subject: "You have a new message from " + name,
      html: generateContactUsEmail({ name, email, subject, message }),
    });

    return res.status(200).json({ message: "Message sent successfully" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const handleAIRiskReportRequest = async (req, res) => {
  const { name, email, phone, jobRole, experience, industry, source, score, band, explanation, answers } = req.body;

  // Validate required fields (use != null to safely handle score = 0)
  if (!name || !email || !source || score == null || !band || !explanation || !answers) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    // 1. Persist to DB first — lead is safe even if emails fail
    const report = new AiRiskReport({ name, email, phone: phone || "", jobRole: jobRole || "", experience: experience || "", industry: industry || "", source, score, band, explanation, answers });
    await report.save();

    // 2. Build email content
    const bandColor = band === 'High Risk' ? '#dc2626' : band === 'Medium Risk' ? '#d97706' : '#059669';
    const bandBg = band === 'High Risk' ? '#fef2f2' : band === 'Medium Risk' ? '#fffbeb' : '#f0fdf4';
    const answerRows = Object.entries(answers).map(([questionId, answer], i) => {
      const bg = i % 2 === 1 ? '#f0f7ff' : '#ffffff';
      return `<tr>
        <td style="padding:8px 12px;background:${bg};border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:600;color:#475569;">${questionId}</td>
        <td style="padding:8px 12px;background:${bg};border-bottom:1px solid #e2e8f0;font-size:12px;color:#1e293b;">${answer.label}</td>
        <td style="padding:8px 12px;background:${bg};border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;">${answer.risk} Risk · ${answer.points} pts</td>
      </tr>`;
    }).join('');

    const adminEmailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#153C85;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#93c5fd;text-transform:uppercase;">Career Shield · Admin</p>
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Technohana</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">New AI Career Risk Test Submission</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#64748b;">A user has completed the AI Career Risk assessment.</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:20px;">
                <tr>
                  <td style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e2e8f0;width:40%;font-size:13px;font-weight:600;color:#475569;">Name</td>
                  <td style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${name}</td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;background:#f0f7ff;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#475569;">Email</td>
                  <td style="padding:10px 12px;background:#f0f7ff;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${email}</td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#475569;">Phone</td>
                  <td style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${phone || '—'}</td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;background:#f0f7ff;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#475569;">Source</td>
                  <td style="padding:10px 12px;background:#f0f7ff;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${source}</td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;background:#ffffff;font-size:13px;font-weight:600;color:#475569;">Risk Band</td>
                  <td style="padding:10px 12px;background:#ffffff;font-size:13px;">
                    <span style="display:inline-block;background:${bandBg};color:${bandColor};font-size:12px;font-weight:700;padding:3px 12px;border-radius:12px;">${band}</span>
                    &nbsp;<span style="font-size:13px;color:#1e293b;font-weight:600;">${score} / 18</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#153C85;text-transform:uppercase;letter-spacing:1px;">Answer Breakdown</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <tr>
                  <td style="padding:8px 12px;background:#153C85;font-size:11px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Question</td>
                  <td style="padding:8px 12px;background:#153C85;font-size:11px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Answer</td>
                  <td style="padding:8px 12px;background:#153C85;font-size:11px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Risk · Points</td>
                </tr>
                ${answerRows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">© 2025 Technohana · <a href="https://technohana.in" style="color:#94a3b8;text-decoration:none;">technohana.in</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const userEmailHtml = generateAiRiskReportEmail({ name, score, band, explanation });

    // 3. Send emails (non-blocking for the response — log failures but don't fail the request)
    Promise.all([
      sendEmail({
        from: fromAddresses.connect,
        to: process.env.MAIL_TO,
        subject: "New AI Career Risk Test Submission",
        html: adminEmailHtml,
      }),
      sendEmail({
        from: fromAddresses.connect,
        to: email,
        subject: `${name}, your AI Career Risk Score is ${score}/18 — here's your roadmap`,
        html: userEmailHtml,
      }),
    ]).catch((err) => {
      console.error("AI risk report emails failed (lead already saved):", err);
    });

    res.status(200).json({ message: "Report saved successfully." });
  } catch (error) {
    console.error("Error saving AI risk report:", error);
    res.status(500).json({ error: "Failed to save report. Please try again later." });
  }
};
