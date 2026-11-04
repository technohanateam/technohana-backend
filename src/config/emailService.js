import { Resend } from "resend";

let resend = null;

function getResend() {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

export const fromAddresses = {
  connect: "Corporate Training <corporate@technohana.in>",
  sales: "Sales <sales@technohana.in>",
  careers: "Careers <careers@technohana.in>",
  auth: "Technohana <login@technohana.in>",
};

// Address copied on CRM reps' outgoing mail and on imported replies. Returns
// undefined when the copy would go to someone already on the message.
export const crmCopyAddress = (...alreadyOnMessage) => {
  const copy = (process.env.CRM_COPY_EMAIL || "abdul@technohana.in").trim().toLowerCase();
  return alreadyOnMessage.some((a) => String(a || "").trim().toLowerCase() === copy) ? undefined : copy;
};

// Make the 'from' address a parameter
// Resolves with Resend's `{ data: { id }, error }`; callers that need the
// message id (e.g. CRM sends, for delivery tracking) read data.id and check error.
export const sendEmail = async ({ from, to, cc, subject, html, text, attachments, replyTo, tags, headers }) => {
  try {
    const resendClient = getResend();
    const data = await resendClient.emails.send({
      from: from, // Use the 'from' parameter
      to: to,
      ...(cc ? { cc } : {}),
      subject: subject,
      html: html,
      ...(text ? { text } : {}),
      ...(attachments ? { attachments } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(tags ? { tags } : {}),
      ...(headers ? { headers } : {}),
    });
    // Resend reports rejections (unverified domain, bad key, invalid recipient) in
    // `error` rather than throwing; callers that care check `result.error`.
    if (data?.error) {
      console.error(`Email to ${to} rejected by Resend ("${subject}"):`, data.error);
    } else {
      console.log(`Email sent to ${to} with subject "${subject}"`);
    }
    return data;
  } catch (err) {
    console.error("Error sending email:", err);
    throw err;
  }
};
