export function generateEnquiryTable(data) {
  const fields = [
    { label: "Name", key: "name" },
    { label: "Email", key: "email" },
    { label: "Phone", key: "phone" },
    { label: "Company", key: "company" },
    { label: "Callback Date/Time", key: "callBackDateTime" },
    { label: "User Type", key: "userType" },
    { label: "Training Type", key: "trainingType" },
    { label: "Training Period", key: "trainingPeriod" },
    { label: "Price", key: "price" },
    { label: "Currency", key: "currency" },
    { label: "Training Location", key: "trainingLocation" },
    { label: "Special Request", key: "specialRequest" },
    { label: "Description", key: "description" },
    { label: "Course Title", key: "courseTitle" },
    { label: "Course ID", key: "courseId" },
    { label: "Created At", key: "createdAt" }
  ];

  return `
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px;background:#f0f4fa;">Field</th>
          <th style="text-align:left;padding:8px;background:#f0f4fa;">Value</th>
        </tr>
      </thead>
      <tbody>
        ${fields
          .map(
            (f) =>
              `<tr>
                <td style="padding:8px;border-bottom:1px solid #eee;">${f.label}</td>
                <td style="padding:8px;border-bottom:1px solid #eee;">${data[f.key] || ""}</td>
              </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

// Enrollment confirmation email template
export function generateEnrollmentConfirmationEmail({ name, courseTitle, trainingType, trainingPeriod, specialRequest, price, currency }) {
  return `
    <div style="font-family:sans-serif;line-height:1.6;">
      <h2 style="color:#1769ff;">Thank you for enrolling${name ? ', ' + name : ''}!</h2>
      <p>We have received your enrollment request for <strong>${courseTitle}</strong>.</p>
      <p>Training Type: <strong>${trainingType || 'Individual'}</strong></p>
      <p>Training Period: <strong>${trainingPeriod || 'Not specified'}</strong></p>
      ${specialRequest ? `<p>Special Request: <strong>${specialRequest}</strong></p>` : ''}
      <p>Price: <strong>${price || 'Contact for pricing'}</strong></p>
      <p>Our team will be in contact with you shortly to confirm your enrollment and provide next steps.</p>
      <p style="margin-top:2em;color:#888;">Best regards,<br/>Technohana Team</p>
    </div>
  `;
}

export function generateResumeAcknowledgementEmail({ name }) {
  return `
    <div style="font-family:sans-serif;line-height:1.6;">
      <h2 style="color:#1769ff;">Application Received${name ? ', ' + name : ''}!</h2>
      <p>Thank you for applying to Technohana. We have received your resume successfully.</p>
      <p>Our team will review your application, and we’ll connect with you if your profile matches our current opportunities.</p>
      <p style="margin-top:2em;color:#888;">Best regards,<br/>Technohana Team</p>
    </div>
  `;
}

export function generateContactUsEmail({name,email,subject,message}){
  return `
    <div style="font-family:sans-serif;line-height:1.6;">
      <h2 style="color:#1769ff;">You have a new message from ${name}!</h2>
      <p>Email: <strong>${email}</strong></p>
      <p>Subject: <strong>${subject}</strong></p>
      <p>Message: <strong>${message}</strong></p>
    </div>
  `;
}

export function generateAIRiskReportRequestEmail({
  name,
  email,
  phone,
  jobRole,
  experience,
  industry,
}) {
  return `
    <div style="font-family:sans-serif;line-height:1.6;">
      <h2 style="color:#1769ff;">New AI Risk Report Request</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Current Job Role:</strong> ${jobRole}</p>
      <p><strong>Years of Experience:</strong> ${experience}</p>
      <p><strong>Preferred AI Career Path:</strong> ${industry}</p>
      <p>This person has requested the AI Career Risk Report. Please follow up accordingly.</p>
      <p style="margin-top:2em;color:#888;">Best regards,<br/>Technohana System</p>
    </div>
  `;
}

export function generateUserConfirmationEmail({ name }) {
  return `
    <div style="font-family:sans-serif;line-height:1.6;">
      <h2 style="color:#1769ff;">Thank You${name ? ', ' + name : ''}!</h2>
      <p>We have received your request for the AI Career Risk Report.</p>
      <p>Our team will connect with you shortly to provide your personalized report and further assistance.</p>
      <p style="margin-top:2em;color:#888;">Best regards,<br/>Technohana Team</p>
    </div>
  `;
}

export function generateAiRiskReportEmail({ name, score, band, explanation }) {
  const bandColor =
    band === "High Risk" ? "#dc2626" : band === "Medium Risk" ? "#d97706" : "#059669";
  const bandBg =
    band === "High Risk" ? "#fef2f2" : band === "Medium Risk" ? "#fffbeb" : "#f0fdf4";
  const bandBorder =
    band === "High Risk" ? "#fca5a5" : band === "Medium Risk" ? "#fcd34d" : "#6ee7b7";

  const bandInsights = {
    "High Risk": [
      "Roles with repetitive or support-level tasks are being automated fastest.",
      "Learning AI co-piloting skills now puts you ahead of 80% of your peers.",
      "The next 90 days are your best window to pivot before the market shifts.",
    ],
    "Medium Risk": [
      "You have a solid foundation — AI skills will accelerate your career significantly.",
      "Developers who integrate AI into their workflow are 2× more productive.",
      "Close your skill gaps now while demand for AI-augmented developers is surging.",
    ],
    "Low Risk": [
      "You're ahead of the curve — keep building to maintain your lead.",
      "Deepening AI leadership skills positions you for architect and principal roles.",
      "Your experience makes you uniquely suited to mentor and lead AI adoption.",
    ],
  };

  const actionPlan = {
    "High Risk": [
      { weeks: "Weeks 1–4", action: "Python basics + prompt engineering fundamentals" },
      { weeks: "Weeks 5–8", action: "Automation tools — APIs, scripts, no-code AI platforms" },
      { weeks: "Weeks 9–12", action: "Complete a real AI integration project for your portfolio" },
    ],
    "Medium Risk": [
      { weeks: "Weeks 1–4", action: "AI integration patterns for your current tech stack" },
      { weeks: "Weeks 5–8", action: "Cloud platforms + MLOps fundamentals" },
      { weeks: "Weeks 9–12", action: "Ship an AI-powered feature in a live or side project" },
    ],
    "Low Risk": [
      { weeks: "Weeks 1–4", action: "LLM architecture, fine-tuning & RAG systems deep-dive" },
      { weeks: "Weeks 5–8", action: "AI product strategy and cross-functional leadership" },
      { weeks: "Weeks 9–12", action: "Lead an AI initiative or mentor junior team members" },
    ],
  };

  const courses = {
    "High Risk": [
      { title: "Python for Machine Learning", duration: "4 weeks", id: "DSML104" },
      { title: "Prompt Engineering with ChatGPT", duration: "2 weeks", id: "GPT102" },
      { title: "Complete Artificial Intelligence for Beginners", duration: "3 weeks", id: "AR103" },
    ],
    "Medium Risk": [
      { title: "Generative AI Essentials", duration: "6 weeks", id: "GENAI108" },
      { title: "Mastering MLOps: Complete Course on ML Operations", duration: "5 weeks", id: "DSML110" },
      { title: "Data Science with Python", duration: "4 weeks", id: "DSML105" },
    ],
    "Low Risk": [
      { title: "Generative AI Specialty", duration: "8 weeks", id: "GENAI101" },
      { title: "Quantization of Large Language Models", duration: "3 weeks", id: "GENAI105" },
      { title: "Build Your AI-Powered Product Startup with Just $100", duration: "4 weeks", id: "AI100STARTUP" },
    ],
  };

  const insights = bandInsights[band] ?? bandInsights["Medium Risk"];
  const plan = actionPlan[band] ?? actionPlan["Medium Risk"];
  const recs = courses[band] ?? courses["Medium Risk"];

  const insightRows = insights
    .map(
      (point) => `
      <tr>
        <td style="padding:6px 0;vertical-align:top;">
          <span style="color:${bandColor};font-weight:700;margin-right:8px;">✓</span>
          <span style="color:#374151;font-size:14px;">${point}</span>
        </td>
      </tr>`
    )
    .join("");

  const planRows = plan
    .map(
      (step) => `
      <tr>
        <td style="padding:10px 0;vertical-align:top;border-bottom:1px solid #f3f4f6;">
          <span style="display:inline-block;background:#153C85;color:#fff;font-size:11px;font-weight:700;border-radius:4px;padding:2px 8px;margin-bottom:4px;">${step.weeks}</span><br/>
          <span style="color:#374151;font-size:14px;">${step.action}</span>
        </td>
      </tr>`
    )
    .join("");

  const courseCards = recs
    .map(
      (c) => `
      <td style="width:33%;padding:6px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1e293b;">${c.title}</p>
          <p style="margin:0 0 10px;font-size:11px;color:#64748b;">${c.duration}</p>
          <a href="https://technohana.in/courses/${c.id}" style="display:inline-block;background:#27A8F5;color:#fff;font-size:11px;font-weight:600;text-decoration:none;padding:5px 12px;border-radius:5px;">View Course</a>
        </div>
      </td>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#153C85;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#93c5fd;text-transform:uppercase;">Career Shield</p>
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Technohana</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:32px 32px 0;">
              <h1 style="margin:0 0 8px;font-size:22px;color:#0f172a;">Hi ${name},</h1>
              <p style="margin:0;font-size:15px;color:#475569;line-height:1.6;">Your AI Career Risk assessment is complete. Here's everything you need to know — and exactly what to do next.</p>
            </td>
          </tr>

          <!-- Score Card -->
          <tr>
            <td style="padding:24px 32px;">
              <div style="background:${bandBg};border:1px solid ${bandBorder};border-radius:10px;padding:24px;text-align:center;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Your AI Career Risk Score</p>
                <p style="margin:0 0 10px;font-size:48px;font-weight:800;color:#0f172a;">${score}<span style="font-size:22px;font-weight:400;color:#64748b;"> / 18</span></p>
                <span style="display:inline-block;background:${bandColor};color:#fff;font-size:13px;font-weight:700;padding:5px 18px;border-radius:20px;">${band}</span>
                <p style="margin:14px 0 0;font-size:14px;color:#374151;line-height:1.6;max-width:440px;margin-left:auto;margin-right:auto;">${explanation}</p>
              </div>
            </td>
          </tr>

          <!-- What This Means -->
          <tr>
            <td style="padding:0 32px 24px;">
              <h2 style="margin:0 0 14px;font-size:16px;color:#0f172a;">What this means for your career</h2>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${insightRows}
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:0 32px;"><div style="border-top:1px solid #e2e8f0;"></div></td></tr>

          <!-- 90-Day Action Plan -->
          <tr>
            <td style="padding:24px 32px;">
              <h2 style="margin:0 0 4px;font-size:16px;color:#0f172a;">Your personalised 90-day action plan</h2>
              <p style="margin:0 0 14px;font-size:13px;color:#64748b;">Tailored for a <strong>${band}</strong> profile.</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${planRows}
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:0 32px;"><div style="border-top:1px solid #e2e8f0;"></div></td></tr>

          <!-- Course Recommendations -->
          <tr>
            <td style="padding:24px 32px;">
              <h2 style="margin:0 0 4px;font-size:16px;color:#0f172a;">Recommended courses for your risk level</h2>
              <p style="margin:0 0 16px;font-size:13px;color:#64748b;">Hand-picked based on your ${band} score.</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>${courseCards}</tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:8px 32px 32px;text-align:center;">
              <a href="https://technohana.in/courses" style="display:inline-block;background:#27A8F5;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">Explore All AI-Proof Courses →</a>
              <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">Live instructor-led · Regional pricing · 35% group discount</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;color:#64748b;">Questions? Email us at <a href="mailto:connect@technohana.in" style="color:#27A8F5;text-decoration:none;">connect@technohana.in</a></p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">Technohana · <a href="https://technohana.in" style="color:#94a3b8;text-decoration:none;">technohana.in</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// --- New templates for Enrollment + Payment Success ---
export function generatePaymentSuccessEmail({
  name,
  courseTitle,
  amountMajor,
  currency,
  enrollmentType,
  participants,
  trainingLocation,
}) {
  const prettyCurrency = String(currency || '').toUpperCase();
  return `
    <div style="font-family:sans-serif;line-height:1.7;color:#111">
      <h2 style="color:#1769ff;margin:0 0 12px">Payment Successful${name ? ', ' + name : ''}!</h2>
      <p style="margin:0 0 10px">We’ve received your payment for <strong>${courseTitle || 'your course'}</strong>.</p>
      <p style="margin:0 0 10px">Amount Paid: <strong>${amountMajor != null ? amountMajor : ''} ${prettyCurrency}</strong></p>
      <p style="margin:0 0 10px">Enrollment: <strong>${enrollmentType || 'individual'}</strong>${participants ? ` • Participants: <strong>${participants}</strong>` : ''}</p>
      ${trainingLocation ? `<p style="margin:0 0 10px">Training Location: <strong>${trainingLocation}</strong></p>` : ''}
      <p style="margin:12px 0 0">All the details regarding the course are on the way. Our team will contact you shortly.</p>
      <p style="margin:18px 0 0;color:#666">Best regards,<br/>Technohana Team</p>
    </div>
  `;
}

export function generateEnrollmentDetailsForSales({
  orderId,
  learner,
  courseInfo,
  amountMinor,
  currency,
  enrollmentType,
  participants,
}) {
  const amountMajor = Number.isFinite(Number(amountMinor)) ? (Number(amountMinor) / 100).toFixed(2) : '';
  const rows = [
    ["Order ID", orderId],
    ["Name", learner?.fullName],
    ["Email", learner?.email],
    ["Phone", learner?.phone],
    ["City", learner?.city],
    ["Training Location", learner?.trainingLocation],
    ["Course Title", courseInfo?.title],
    ["Course Duration", courseInfo?.duration],
    ["Course Time", courseInfo?.time],
    ["Enrollment Type", enrollmentType],
    ["Participants", participants],
    ["Amount Paid", `${amountMajor} ${String(currency || '').toUpperCase()}`],
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;width:180px;background:#f8fafc"><strong>${label}</strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${value ?? ''}</td>
      </tr>`
    )
    .join("");

  return `
    <div style="font-family:sans-serif;line-height:1.6;color:#111">
      <h2 style="color:#1769ff;margin:0 0 12px">New Paid Enrollment</h2>
      <p style="margin:0 0 14px">A Stripe checkout session has completed successfully. Details below:</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif">${tableRows}</table>
      <p style="margin-top:16px;color:#666">Generated by Technohana system.</p>
    </div>
  `;
}