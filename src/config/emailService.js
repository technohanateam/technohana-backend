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
};

// Make the 'from' address a parameter
export const sendEmail = async ({ from, to, subject, html }) => {
  try {
    const resendClient = getResend();
    const data = await resendClient.emails.send({
      from: from, // Use the 'from' parameter
      to: to,
      subject: subject,
      html: html,
    });
    console.log(`Email sent to ${to} with subject "${subject}"`);
    return data;
  } catch (err) {
    console.error("Error sending email:", err);
    throw err;
  }
};
