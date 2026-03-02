import Subscription from '../models/subscription.model.js';
import { sendEmail, fromAddresses } from '../config/emailService.js';

export const createSubscription = async (req, res) => {
  try {
    const { email, subscribeTo } = req.body;

    // Basic validation
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    // Check if email already exists
    const existingSubscription = await Subscription.findOne({ email });
    if (existingSubscription) {
      return res.status(400).json({ message: 'This email is already subscribed.' });
    }

    const subscription = new Subscription({
      email,
      subscribeTo: subscribeTo || "the latest news, courses, and AI events",
    });
    await subscription.save();

    // Send welcome email to subscriber
    await sendEmail({
      from: fromAddresses.sales,
      to: email,
      subject: "Welcome to Technohana Newsletter!",
      html: `<!DOCTYPE html>
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
          <tr>
            <td style="background:#153C85;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#93c5fd;text-transform:uppercase;">Newsletter</p>
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Technohana</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">Welcome aboard!</h2>
              <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">Thank you for subscribing. You're now part of a community of learners building skills for the AI-powered workplace. Here's what's coming your way:</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                    <span style="color:#27A8F5;font-weight:700;margin-right:10px;">→</span>
                    <span style="font-size:14px;color:#1e293b;">Latest AI courses and training programs</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                    <span style="color:#27A8F5;font-weight:700;margin-right:10px;">→</span>
                    <span style="font-size:14px;color:#1e293b;">Industry insights and trends</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                    <span style="color:#27A8F5;font-weight:700;margin-right:10px;">→</span>
                    <span style="font-size:14px;color:#1e293b;">Upcoming events and webinars</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;">
                    <span style="color:#27A8F5;font-weight:700;margin-right:10px;">→</span>
                    <span style="font-size:14px;color:#1e293b;">Exclusive offers and discounts</span>
                  </td>
                </tr>
              </table>
              <div style="text-align:center;margin-top:28px;">
                <a href="https://technohana.in/courses" style="display:inline-block;background:#27A8F5;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:8px;">Browse Courses →</a>
              </div>
            </td>
          </tr>
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
</html>`,
    });

    res.status(201).json({ 
      message: 'Subscription successful! Welcome to our newsletter.',
      success: true 
    });
    console.log("Subscription created and emails sent successfully");
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};

export const sendNewsletter = async (req, res) => {
  try {
    const { subject, content, htmlContent } = req.body;

    // Basic validation
    if (!subject || (!content && !htmlContent)) {
      return res.status(400).json({ 
        message: 'Subject and content (either text or HTML) are required.' 
      });
    }

    // Get all active subscribers
    const subscribers = await Subscription.find({ isActive: true });
    
    if (subscribers.length === 0) {
      return res.status(404).json({ 
        message: 'No active subscribers found.' 
      });
    }

    let successCount = 0;
    let failureCount = 0;
    const failedEmails = [];

    // Send newsletter to each subscriber
    for (const subscriber of subscribers) {
      try {
        const issueDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const mailOptions = {
          from: process.env.MAIL_FROM || 'no-reply@technohana.in',
          to: subscriber.email,
          subject: subject,
          html: htmlContent || `<!DOCTYPE html>
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
          <tr>
            <td style="background:#153C85;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#93c5fd;text-transform:uppercase;">Newsletter · ${issueDate}</p>
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Technohana</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <div style="font-size:14px;color:#374151;line-height:1.8;">
                ${content ? content.replace(/\n/g, '<br>') : ''}
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;color:#64748b;">Questions? <a href="mailto:connect@technohana.in" style="color:#27A8F5;text-decoration:none;">connect@technohana.in</a></p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">You're receiving this because you subscribed to the Technohana newsletter.</p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">© 2025 Technohana · <a href="https://technohana.in" style="color:#94a3b8;text-decoration:none;">technohana.in</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
        };

        await sendEmail(mailOptions);
        successCount++;
        
        // Add a small delay to avoid overwhelming the email service
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`Failed to send newsletter to ${subscriber.email}:`, error);
        failureCount++;
        failedEmails.push(subscriber.email);
      }
    }

    res.status(200).json({
      message: `Newsletter sent successfully!`,
      summary: {
        totalSubscribers: subscribers.length,
        successCount,
        failureCount,
        failedEmails: failedEmails.length > 0 ? failedEmails : undefined
      }
    });

    console.log(`Newsletter sent: ${successCount} successful, ${failureCount} failed`);
    
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
}; 