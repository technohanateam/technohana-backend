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