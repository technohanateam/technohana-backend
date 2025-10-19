import { connect } from "mongoose";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const fromAddresses = {
    connect: "Talk to Advisor <connect@technohana.com>",
    sales: "Technohana Sales <sales@technohana.com>",
    careers: "Technohana Careers <careers@technohana.com>",
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
