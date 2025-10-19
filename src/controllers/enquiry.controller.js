import Enquiry from "../models/enquiry.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateEnquiryTable } from "../utils/emailTemplate.js";
import { generateContactUsEmail } from "../utils/emailTemplate.js";
import { generateAIRiskReportRequestEmail, generateUserConfirmationEmail } from "../utils/emailTemplate.js";

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
      to: "sales@technohana.com", // Your internal recipient
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

    await sendEmail(
      "connect@technohana.com",
      "You have a new message from " + name,
      generateContactUsEmail({ name, email, subject, message })
    );

    return res.status(200).json({ message: "Message sent successfully" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const handleAIRiskReportRequest = async (req, res) => {
  const { name, email, source, score, band, explanation, answers } = req.body;

  // Validate required fields
  if (!name || !email || !source || !score || !band || !explanation || !answers) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    // Generate email templates
    const adminEmailHtml = `
      <div style="font-family:sans-serif;line-height:1.6;">
        <h2 style="color:#1769ff;">New AI Career Risk Test Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Source:</strong> ${source}</p>
        <p><strong>Score:</strong> ${score}</p>
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
        <p><strong>Your Score:</strong> ${score}</p>
        <p><strong>Risk Band:</strong> ${band}</p>
        <p>${explanation}</p>
        <p>Our team will review your submission and provide a personalized roadmap to help you future-proof your career.</p>
        <p style="margin-top:2em;color:#888;">Best regards,<br/>Technohana Team</p>
      </div>
    `;

    // Send email to admin
    await sendEmail({
      from: fromAddresses.connect,
      to: fromAddresses.sales, // Replace with the admin email
      subject: "New AI Career Risk Test Submission",
      html: adminEmailHtml,
    });

    // Send confirmation email to the user
    await sendEmail({
      from: fromAddresses.connect,
      to: email,
      subject: "Thank You for Completing the AI Career Risk Test",
      html: userEmailHtml,
    });

    res.status(200).json({ message: "Emails sent successfully." });
  } catch (error) {
    console.error("Error sending emails:", error);
    res.status(500).json({ error: "Failed to send emails. Please try again later." });
  }
};
