import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const fromAddresses = {
    connect: "Corporate Training <corporate@technohana.in>",
    sales: "Sales <sales@technohana.in>",
    careers: "Careers <careers@technohana.in>",
  };
  
  // Make the 'from' address a parameter
  export const sendEmail = async ({ from, to, subject, html }) => {
    try {
      const data = await resend.emails.send({
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
