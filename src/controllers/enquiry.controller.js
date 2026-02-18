import Enquiry from "../models/enquiry.model.js";
import AiRiskReport from "../models/aiRiskReport.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateEnquiryTable } from "../utils/emailTemplate.js";
import { generateContactUsEmail } from "../utils/emailTemplate.js";

export const createEnquiry = async (req, res) => {
  try {
    const {
      // ... other fields
      courseTitle,
      enquiryType, // <-- GET THE NEW FIELD
    } = req.body;

    // ... your validation and database saving logic ...
    const enquiry = new Enquiry(req.body);
    await enquiry.save();

    // --- DYNAMIC SUBJECT LOGIC ---
    let subject;
    switch (enquiryType) {
      case "Quote Request":
        subject = `New Quote Request for: ${courseTitle}`;
        break;
      case "Syllabus Download":
        subject = `Syllabus Downloaded for: ${courseTitle}`;
        break;
      case "General Enquiry":
      default: // A good default in case enquiryType is not sent
        subject = `New General Enquiry for: ${courseTitle}`;
        break;
    }

    // Send email to admin with the dynamic subject
    await sendEmail({
      from: fromAddresses.sales, // Specify the 'from' address
      to: "sales@technohana.in", // Your internal recipient
      subject: subject, // Use the dynamic subject
      html: generateEnquiryTable(req.body),
    });

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
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    await sendEmail({
      from: fromAddresses.connect,
      to: "corporate@technohana.in",
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
  const { name, email, phone, source, score, band, explanation, answers } = req.body;

  // Validate required fields (use != null to safely handle score = 0)
  if (!name || !email || !source || score == null || !band || !explanation || !answers) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    // 1. Persist to DB first — lead is safe even if emails fail
    const report = new AiRiskReport({ name, email, phone: phone || "", source, score, band, explanation, answers });
    await report.save();

    // 2. Build email content
    const adminEmailHtml = `
      <div style="font-family:sans-serif;line-height:1.6;">
        <h2 style="color:#1769ff;">New AI Career Risk Test Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || "—"}</p>
        <p><strong>Source:</strong> ${source}</p>
        <p><strong>Score:</strong> ${score} / 18</p>
        <p><strong>Risk Band:</strong> ${band}</p>
        <p><strong>Explanation:</strong> ${explanation}</p>
        <p><strong>Answers:</strong></p>
        <ul>
          ${Object.entries(answers)
            .map(
              ([questionId, answer]) =>
                `<li><strong>${questionId}:</strong> ${answer.label} (${answer.risk} Risk, ${answer.points} Points)</li>`
            )
            .join("")}
        </ul>
        <p style="margin-top:2em;color:#888;">Best regards,<br/>Technohana System</p>
      </div>
    `;

    const userEmailHtml = `
      <div style="font-family:sans-serif;line-height:1.6;">
        <h2 style="color:#1769ff;">Thank You, ${name}!</h2>
        <p>We have received your AI Career Risk Test submission.</p>
        <p><strong>Your Score:</strong> ${score} / 18</p>
        <p><strong>Risk Band:</strong> ${band}</p>
        <p>${explanation}</p>
        <p>Our team will review your submission and provide a personalized roadmap to help you future-proof your career.</p>
        <p style="margin-top:2em;color:#888;">Best regards,<br/>Technohana Team</p>
      </div>
    `;

    // 3. Send emails (non-blocking for the response — log failures but don't fail the request)
    Promise.all([
      sendEmail({
        from: fromAddresses.connect,
        to: "abdul@technohana.in",
        subject: "New AI Career Risk Test Submission",
        html: adminEmailHtml,
      }),
      sendEmail({
        from: fromAddresses.connect,
        to: email,
        subject: "Thank You for Completing the AI Career Risk Test",
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
