import Lead from "../models/lead.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateLeadMagnetEmail, generateLeadAdminEmail } from "../utils/emailTemplate.js";

export const capturePersonaLead = async (req, res) => {
  const { name, email, persona, utm = {} } = req.body;

  if (!name || !email || !persona) {
    return res.status(400).json({ success: false, message: "Name, email, and persona are required." });
  }

  try {
    const lead = new Lead({ name, email, persona, utm });
    await lead.save();

    Promise.all([
      sendEmail({
        from: fromAddresses.connect,
        to: process.env.MAIL_TO,
        subject: `New Persona Lead — ${persona}`,
        html: generateLeadAdminEmail({ name, email, persona }),
      }),
      sendEmail({
        from: fromAddresses.connect,
        to: email,
        subject: `Your free resource from Technohana is here, ${name}`,
        html: generateLeadMagnetEmail({ name, persona }),
      }),
    ]).catch((err) => console.error("Lead emails failed (lead already saved):", err));

    return res.status(200).json({ success: true, message: "Lead captured." });
  } catch (err) {
    console.error("Lead capture error:", err);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};
