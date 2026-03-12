// Shared layout helper — wraps content in the branded email shell
function emailShell({ label, title = 'Technohana', body }) {
  return `<!DOCTYPE html>
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

          <!-- Header -->
          <tr>
            <td style="background:#153C85;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#93c5fd;text-transform:uppercase;">${label}</p>
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">${title}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;color:#64748b;">Questions? <a href="mailto:connect@technohana.in" style="color:#27A8F5;text-decoration:none;">connect@technohana.in</a></p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">© 2025 Technohana · <a href="https://technohana.in" style="color:#94a3b8;text-decoration:none;">technohana.in</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Renders a 2-column data table row
function dataRow(label, value, shade) {
  const bg = shade ? '#f0f7ff' : '#ffffff';
  return `<tr>
    <td style="padding:10px 12px;background:${bg};border-bottom:1px solid #e2e8f0;width:40%;font-size:13px;font-weight:600;color:#475569;">${label}</td>
    <td style="padding:10px 12px;background:${bg};border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${value || '—'}</td>
  </tr>`;
}

// CTA button
function ctaButton(text, href) {
  return `<div style="text-align:center;margin-top:28px;">
    <a href="${href}" style="display:inline-block;background:#27A8F5;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:8px;">${text}</a>
  </div>`;
}

// ─── ENQUIRY / ADMIN TABLE ────────────────────────────────────────────────────

export function generateEnquiryTable(data) {
  const fields = [
    { label: 'Name', key: 'name' },
    { label: 'Email', key: 'email' },
    { label: 'Phone', key: 'phone' },
    { label: 'Company', key: 'company' },
    { label: 'Enquiry Type', key: 'enquiryType' },
    { label: 'Selected Package', key: 'selectedPackage' },
    { label: 'Timeline', key: 'timeline' },
    { label: 'Requirements', key: 'requirements' },
    { label: 'Callback Date/Time', key: 'callBackDateTime' },
    { label: 'User Type', key: 'userType' },
    { label: 'Training Type', key: 'trainingType' },
    { label: 'Training Period', key: 'trainingPeriod' },
    { label: 'Price', key: 'price' },
    { label: 'Currency', key: 'currency' },
    { label: 'Training Location', key: 'trainingLocation' },
    { label: 'Special Request', key: 'specialRequest' },
    { label: 'Description', key: 'description' },
    { label: 'Course Title', key: 'courseTitle' },
    { label: 'Course ID', key: 'courseId' },
    { label: 'Pipeline', key: 'pipeline' },
    { label: 'Service Line', key: 'serviceLine' },
    { label: 'Campaign', key: 'campaign' },
    { label: 'Landing Page', key: 'landingPage' },
    { label: 'Created At', key: 'createdAt' },
  ];

  const rows = fields
    .filter((f) => data[f.key])
    .map((f, i) => dataRow(f.label, data[f.key], i % 2 === 1))
    .join('');

  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">New Enquiry</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;">A new submission has been received. Details below.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      ${rows}
    </table>`;

  return emailShell({ label: 'Admin Notification', body });
}

// ─── ENQUIRY CONFIRMATION (user) ─────────────────────────────────────────────

export function generateEnquiryConfirmationEmail({ name, enquiryType, courseTitle, selectedPackage, timeline }) {
  const subject = enquiryType || courseTitle || 'your request';
  const packageRow = selectedPackage ? dataRow('Selected Package', selectedPackage, true) : '';
  const timelineRow = timeline ? dataRow('Your Timeline', timeline, !!selectedPackage) : '';

  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">We've received your request${name ? `, ${name}` : ''}!</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
      Thank you for reaching out about <strong style="color:#1e293b;">${subject}</strong>.
      Our team will contact you within <strong style="color:#1e293b;">24 hours</strong> to schedule a discovery call.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      ${dataRow('Status', 'Under Review', false)}
      ${packageRow}
      ${timelineRow}
      ${dataRow('Next Step', 'Discovery call — we will send a calendar invite', selectedPackage ? true : false)}
    </table>
    ${ctaButton('View Build Packages', `${process.env.FRONTEND_URL || 'https://technohana.in'}/build/ai-agent#packages`)}`;

  return emailShell({ label: 'Enquiry Confirmation', body });
}

// ─── ENROLLMENT CONFIRMATION (user) ──────────────────────────────────────────

export function generateEnrollmentConfirmationEmail({ name, courseTitle, trainingType, trainingPeriod, specialRequest, price, currency }) {
  const rows = [
    dataRow('Course', courseTitle, false),
    dataRow('Training Type', trainingType || 'Individual', true),
    dataRow('Training Period', trainingPeriod || 'Not specified', false),
    specialRequest ? dataRow('Special Request', specialRequest, true) : '',
    dataRow('Price', price ? `${price} ${String(currency || '').toUpperCase()}` : 'Contact for pricing', specialRequest ? false : true),
  ].join('');

  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">Enrollment Received${name ? `, ${name}` : ''}!</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">We've received your enrollment request for <strong style="color:#1e293b;">${courseTitle}</strong>. Our team will be in touch shortly to confirm your place and provide next steps.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      ${rows}
    </table>
    ${ctaButton('View My Enrollments', `${process.env.FRONTEND_URL || 'https://technohana.in'}/my-enrollments`)}`;

  return emailShell({ label: 'Enrollment Confirmation', body });
}

// ─── INSTRUCTOR APPLICATION ACK (applicant) ───────────────────────────────────

export function generateResumeAcknowledgementEmail({ name }) {
  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">Application Received${name ? `, ${name}` : ''}!</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">Thank you for applying to teach with Technohana. We've received your resume and cover letter successfully.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      ${dataRow('Status', 'Under Review', false)}
      ${dataRow('Next Step', 'Our team will reach out if your profile matches current opportunities', true)}
      ${dataRow('Expected Response', '5–7 business days', false)}
    </table>
    ${ctaButton('Visit Technohana', 'https://technohana.in')}`;

  return emailShell({ label: 'Careers', body });
}

// ─── CONTACT US (admin) ──────────────────────────────────────────────────────

export function generateContactUsEmail({ name, email, subject, message }) {
  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">New Contact Message</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;">Received via the Contact Us form.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      ${dataRow('From', name, false)}
      ${dataRow('Email', `<a href="mailto:${email}" style="color:#27A8F5;text-decoration:none;">${email}</a>`, true)}
      ${dataRow('Subject', subject, false)}
    </table>
    <div style="margin-top:20px;background:#f8fafc;border-left:4px solid #27A8F5;border-radius:0 8px 8px 0;padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Message</p>
      <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.7;">${message}</p>
    </div>`;

  return emailShell({ label: 'Contact Form', body });
}

// ─── AI RISK REPORT REQUEST (admin) ──────────────────────────────────────────

export function generateAIRiskReportRequestEmail({ name, email, phone, jobRole, experience, industry }) {
  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">New AI Risk Report Request</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;">A user has submitted the AI Career Risk assessment. Details below.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      ${dataRow('Name', name, false)}
      ${dataRow('Email', email, true)}
      ${dataRow('Phone', phone, false)}
      ${dataRow('Current Job Role', jobRole, true)}
      ${dataRow('Years of Experience', experience, false)}
      ${dataRow('Preferred AI Career Path', industry, true)}
    </table>`;

  return emailShell({ label: 'Career Shield · Admin', body });
}

// ─── USER CONFIRMATION (generic — currently unused) ───────────────────────────

export function generateUserConfirmationEmail({ name }) {
  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">Thank You${name ? `, ${name}` : ''}!</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">We've received your request for the AI Career Risk Report. Our team will connect with you shortly to provide your personalised report and further assistance.</p>
    ${ctaButton('Explore Courses', 'https://technohana.in/courses')}`;

  return emailShell({ label: 'Career Shield', body });
}

// ─── AI CAREER RISK REPORT (user) — DO NOT MODIFY ────────────────────────────

export function generateAiRiskReportEmail({ name, score, band, explanation }) {
  const bandColor =
    band === 'High Risk' ? '#dc2626' : band === 'Medium Risk' ? '#d97706' : '#059669';
  const bandBg =
    band === 'High Risk' ? '#fef2f2' : band === 'Medium Risk' ? '#fffbeb' : '#f0fdf4';
  const bandBorder =
    band === 'High Risk' ? '#fca5a5' : band === 'Medium Risk' ? '#fcd34d' : '#6ee7b7';

  const bandInsights = {
    'High Risk': [
      'Roles with repetitive or support-level tasks are being automated fastest.',
      'Learning AI co-piloting skills now puts you ahead of 80% of your peers.',
      'The next 90 days are your best window to pivot before the market shifts.',
    ],
    'Medium Risk': [
      'You have a solid foundation — AI skills will accelerate your career significantly.',
      'Developers who integrate AI into their workflow are 2× more productive.',
      'Close your skill gaps now while demand for AI-augmented developers is surging.',
    ],
    'Low Risk': [
      'You\'re ahead of the curve — keep building to maintain your lead.',
      'Deepening AI leadership skills positions you for architect and principal roles.',
      'Your experience makes you uniquely suited to mentor and lead AI adoption.',
    ],
  };

  const actionPlan = {
    'High Risk': [
      { weeks: 'Weeks 1–4', action: 'Python basics + prompt engineering fundamentals' },
      { weeks: 'Weeks 5–8', action: 'Automation tools — APIs, scripts, no-code AI platforms' },
      { weeks: 'Weeks 9–12', action: 'Complete a real AI integration project for your portfolio' },
    ],
    'Medium Risk': [
      { weeks: 'Weeks 1–4', action: 'AI integration patterns for your current tech stack' },
      { weeks: 'Weeks 5–8', action: 'Cloud platforms + MLOps fundamentals' },
      { weeks: 'Weeks 9–12', action: 'Ship an AI-powered feature in a live or side project' },
    ],
    'Low Risk': [
      { weeks: 'Weeks 1–4', action: 'LLM architecture, fine-tuning & RAG systems deep-dive' },
      { weeks: 'Weeks 5–8', action: 'AI product strategy and cross-functional leadership' },
      { weeks: 'Weeks 9–12', action: 'Lead an AI initiative or mentor junior team members' },
    ],
  };

  const courses = {
    'High Risk': [
      { title: 'Python for Machine Learning', duration: '4 weeks', id: 'DSML104' },
      { title: 'Prompt Engineering with ChatGPT', duration: '2 weeks', id: 'GPT102' },
      { title: 'Complete Artificial Intelligence for Beginners', duration: '3 weeks', id: 'AR103' },
    ],
    'Medium Risk': [
      { title: 'Generative AI Essentials', duration: '6 weeks', id: 'GENAI108' },
      { title: 'Mastering MLOps: Complete Course on ML Operations', duration: '5 weeks', id: 'DSML110' },
      { title: 'Data Science with Python', duration: '4 weeks', id: 'DSML105' },
    ],
    'Low Risk': [
      { title: 'Generative AI Specialty', duration: '8 weeks', id: 'GENAI101' },
      { title: 'Quantization of Large Language Models', duration: '3 weeks', id: 'GENAI105' },
      { title: 'Build Your AI-Powered Product Startup with Just $100', duration: '4 weeks', id: 'AI100STARTUP' },
    ],
  };

  const insights = bandInsights[band] ?? bandInsights['Medium Risk'];
  const plan = actionPlan[band] ?? actionPlan['Medium Risk'];
  const recs = courses[band] ?? courses['Medium Risk'];

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
    .join('');

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
    .join('');

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
    .join('');

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

// ─── PAYMENT SUCCESS (learner) ────────────────────────────────────────────────

export function generatePaymentSuccessEmail({ name, courseTitle, amountMajor, currency, enrollmentType, participants, trainingLocation }) {
  const prettyCurrency = String(currency || '').toUpperCase();

  const body = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;background:#f0fdf4;border:2px solid #6ee7b7;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:28px;margin-bottom:12px;">✓</div>
      <h2 style="margin:0 0 6px;font-size:22px;color:#0f172a;">Payment Confirmed${name ? `, ${name}` : ''}!</h2>
      <p style="margin:0;font-size:14px;color:#64748b;">Your enrollment is confirmed. We'll be in touch shortly.</p>
    </div>
    <div style="background:#f0f7ff;border-radius:10px;padding:20px 24px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Amount Paid</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:#153C85;">${amountMajor != null ? amountMajor : ''} <span style="font-size:18px;font-weight:500;">${prettyCurrency}</span></p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      ${dataRow('Course', courseTitle || 'Your course', false)}
      ${dataRow('Enrollment Type', enrollmentType || 'Individual', true)}
      ${participants ? dataRow('Participants', participants, false) : ''}
      ${trainingLocation ? dataRow('Training Location', trainingLocation, participants ? true : false) : ''}
    </table>
    ${ctaButton('View My Dashboard', `${process.env.FRONTEND_URL || 'https://technohana.in'}/dashboard`)}`;

  return emailShell({ label: 'Payment Confirmation', body });
}

// ─── ENROLLMENT DETAILS FOR SALES (admin) ────────────────────────────────────

export function generateEnrollmentDetailsForSales({ orderId, learner, courseInfo, amountMinor, currency, enrollmentType, participants }) {
  const amountMajor = Number.isFinite(Number(amountMinor)) ? (Number(amountMinor) / 100).toFixed(2) : '';
  const prettyCurrency = String(currency || '').toUpperCase();

  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">New Paid Enrollment</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;">A payment has been confirmed. Full details below.</p>

    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#153C85;text-transform:uppercase;letter-spacing:1px;">Order</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:20px;">
      ${dataRow('Order ID', orderId, false)}
      ${dataRow('Amount Paid', `${amountMajor} ${prettyCurrency}`, true)}
      ${dataRow('Enrollment Type', enrollmentType, false)}
      ${participants ? dataRow('Participants', participants, true) : ''}
    </table>

    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#153C85;text-transform:uppercase;letter-spacing:1px;">Learner</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:20px;">
      ${dataRow('Full Name', learner?.fullName, false)}
      ${dataRow('Email', learner?.email, true)}
      ${dataRow('Phone', learner?.phone, false)}
      ${dataRow('City', learner?.city, true)}
      ${dataRow('Training Location', learner?.trainingLocation, false)}
    </table>

    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#153C85;text-transform:uppercase;letter-spacing:1px;">Course</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
      ${dataRow('Title', courseInfo?.title, false)}
      ${dataRow('Duration', courseInfo?.duration, true)}
      ${dataRow('Time', courseInfo?.time, false)}
    </table>`;

  return emailShell({ label: 'Sales Notification', body });
}

// ─── ABANDONED CART RECOVERY (learner) ───────────────────────────────────────

export function generateAbandonedCartEmail({ name, courseTitle, couponCode = 'LAUNCH10' }) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://technohana.in';
  const courseLine = courseTitle
    ? `<p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">You started enrolling in <strong style="color:#1e293b;">${courseTitle}</strong> but didn't complete your payment. Your spot is not confirmed yet.</p>`
    : `<p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">You started an enrollment but didn't complete your payment. Your spot is not confirmed yet.</p>`;

  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">Still thinking it over${name ? `, ${name}` : ''}?</h2>
    ${courseLine}
    <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:10px;padding:20px 24px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#7c3aed;text-transform:uppercase;letter-spacing:1px;">Exclusive offer just for you</p>
      <p style="margin:0 0 4px;font-size:28px;font-weight:800;color:#4c1d95;letter-spacing:0.05em;">${couponCode}</p>
      <p style="margin:0;font-size:13px;color:#6d28d9;">Use this code at checkout for <strong>10% off</strong></p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:24px;">
      ${dataRow('Live instructor-led training', '✓ Not pre-recorded videos', false)}
      ${dataRow('Group discounts', 'Up to 35% off for teams of 10+', true)}
      ${dataRow('Regional pricing', 'INR · AED · USD · GBP · EUR', false)}
      ${dataRow('Career Shield', 'Job support + interview prep included', true)}
    </table>
    ${ctaButton('Complete My Enrollment →', `${frontendUrl}/courses`)}
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center;">Questions? Reply to this email or chat with us at <a href="${frontendUrl}" style="color:#7c3aed;text-decoration:none;">technohana.in</a></p>`;

  return emailShell({ label: 'Enrollment Recovery', title: 'Technohana', body });
}

// ─── POST-ENROLLMENT DAY 3 — Getting Started Tips (learner) ──────────────────

export function generateDay3Email({ name, courseTitle }) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://technohana.in';
  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">3 days in — how's it going${name ? `, ${name}` : ''}?</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
      You've just started <strong style="color:#1e293b;">${courseTitle || 'your Technohana course'}</strong>. Here are a few things that help learners get the most out of live training:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:24px;">
      ${dataRow('1. Block time on your calendar', 'Treat each session like a meeting you can\'t skip. Consistency beats intensity.', false)}
      ${dataRow('2. Take notes in your own words', 'Don\'t just copy slides — summarise concepts in your own language. It accelerates retention.', true)}
      ${dataRow('3. Ask questions live', 'Your instructor is there in real time. No question is too basic — it helps everyone.', false)}
      ${dataRow('4. Do the exercises the same day', 'Hands-on practice within 24h of each session doubles retention.', true)}
      ${dataRow('5. Join the alumni community', 'Connect with your cohort. They\'re your network after graduation.', false)}
    </table>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
      If you need anything — reschedule, materials, or a question between sessions — just reply to this email.
    </p>
    ${ctaButton('Go to My Dashboard →', `${frontendUrl}/dashboard`)}`;

  return emailShell({ label: 'Learning Tips', title: 'Technohana', body });
}

// ─── POST-ENROLLMENT DAY 7 — What's Next (learner) ───────────────────────────

export function generateDay7Email({ name, courseTitle }) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://technohana.in';
  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">One week in — you're doing great${name ? `, ${name}` : ''}!</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
      You're one week into <strong style="color:#1e293b;">${courseTitle || 'your course'}</strong>. This is typically when the most impactful learning happens — real concepts, real practice.
    </p>
    <div style="background:#f0fdf4;border:1px solid #6ee7b7;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:1px;">Thinking ahead?</p>
      <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.6;">
        Many of our learners complete one course and immediately enrol in a complementary track. Explore our full catalog — and remember, teams of 5+ save 25%, teams of 10+ save 35%.
      </p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:24px;">
      ${dataRow('Refer a colleague', 'Earn a discount on your next course for every successful referral.', false)}
      ${dataRow('Bring your team', 'Group enrollment gets up to 35% off — share with your manager.', true)}
      ${dataRow('Career Shield', 'Our career support programme is available to all learners post-completion.', false)}
    </table>
    ${ctaButton('Explore More Courses →', `${frontendUrl}/courses`)}`;

  return emailShell({ label: 'Week 1 Update', title: 'Technohana', body });
}
