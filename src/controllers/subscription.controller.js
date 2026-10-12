import Subscription from '../models/subscription.model.js';
import { sendEmail, fromAddresses } from '../config/emailService.js';
import { withUnsubscribe, verifyUnsubscribeToken, suppressEmail } from '../services/emailSuppression.js';

export const createSubscription = async (req, res) => {
  try {
    const { email, subscribeTo } = req.body;

    // Basic validation
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    // Case-insensitive: the suppression list stores lowercased addresses.
    const existingSubscription = await Subscription.findOne({ email }).collation({ locale: 'en', strength: 2 });
    if (existingSubscription?.isActive) {
      return res.status(400).json({ message: 'This email is already subscribed.' });
    }

    if (existingSubscription) {
      // Subscribing again is an explicit opt-in, so it lifts an earlier
      // unsubscribe/bounce suppression (see services/emailSuppression.js).
      existingSubscription.isActive = true;
      existingSubscription.unsubscribedAt = undefined;
      existingSubscription.unsubscribeReason = undefined;
      existingSubscription.subscribeTo = subscribeTo || "the latest news, courses, and AI events";
      await existingSubscription.save();
    } else {
      const subscription = new Subscription({
        email,
        subscribeTo: subscribeTo || "the latest news, courses, and AI events",
      });
      await subscription.save();
    }

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
              <p style="margin:0;font-size:22px;font-weight:700;"><span style="color:#8B5CF6;">Techno</span><span style="color:#FFC107;">hana</span></p>
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
                <a href="https://www.technohana.in/courses" style="display:inline-block;background:#27A8F5;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:8px;">Browse Courses →</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;color:#64748b;">Questions? <a href="mailto:connect@technohana.in" style="color:#27A8F5;text-decoration:none;">connect@technohana.in</a></p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} Technohana · <a href="https://www.technohana.in" style="color:#94a3b8;text-decoration:none;">technohana.in</a></p>
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
              <p style="margin:0;font-size:22px;font-weight:700;"><span style="color:#8B5CF6;">Techno</span><span style="color:#FFC107;">hana</span></p>
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
              <p style="margin:0;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} Technohana · <a href="https://www.technohana.in" style="color:#94a3b8;text-decoration:none;">technohana.in</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
        };

        await sendEmail({ ...mailOptions, ...withUnsubscribe(mailOptions.html, subscriber.email) });
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

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const unsubscribePage = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${title} · Technohana</title>
</head>
<body style="margin:0;padding:48px 16px;background:#f1f5f9;font-family:Arial,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.08);text-align:center;">
    <p style="margin:0 0 20px;font-size:22px;font-weight:700;"><span style="color:#8B5CF6;">Techno</span><span style="color:#FFC107;">hana</span></p>
    ${body}
  </div>
</body>
</html>`;

const invalidLinkPage = () =>
  unsubscribePage(
    'Invalid link',
    `<p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">This unsubscribe link is invalid or incomplete. Email <a href="mailto:unsubscribe@technohana.in" style="color:#7C3AED;">unsubscribe@technohana.in</a> and we'll remove you.</p>`
  );

// GET /unsubscribe?e=&t= — confirmation page only. Unsubscribing on GET would
// let corporate link scanners (Safe Links, Mimecast), which prefetch every URL
// in an email, unsubscribe B2B recipients who never clicked anything.
export const showUnsubscribePage = (req, res) => {
  const { e, t } = req.query;
  if (!verifyUnsubscribeToken(e, t)) {
    return res.status(400).type('html').send(invalidLinkPage());
  }
  const action = `/unsubscribe?${new URLSearchParams({ e, t })}`;
  return res.type('html').send(
    unsubscribePage(
      'Unsubscribe',
      `<h1 style="margin:0 0 8px;font-size:18px;color:#0f172a;">Unsubscribe from marketing emails?</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;"><strong>${escapeHtml(e)}</strong> will stop receiving Technohana newsletters and campaigns. Receipts and account emails are not affected.</p>
    <form method="POST" action="${escapeHtml(action)}">
      <button type="submit" style="background:#7C3AED;color:#ffffff;border:0;border-radius:8px;padding:12px 28px;font-size:14px;font-weight:700;cursor:pointer;">Unsubscribe</button>
    </form>`
    )
  );
};

// POST /unsubscribe?e=&t= — the confirm button above, and RFC 8058 one-click
// requests that Gmail/Yahoo send from the List-Unsubscribe-Post header.
export const confirmUnsubscribe = async (req, res) => {
  const { e, t } = req.query;
  if (!verifyUnsubscribeToken(e, t)) {
    return res.status(400).type('html').send(invalidLinkPage());
  }
  try {
    await suppressEmail(e, 'unsubscribed');
    const siteUrl = process.env.FRONTEND_URL || 'https://www.technohana.in';
    return res.type('html').send(
      unsubscribePage(
        'Unsubscribed',
        `<h1 style="margin:0 0 8px;font-size:18px;color:#0f172a;">You're unsubscribed</h1>
    <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;"><strong>${escapeHtml(e)}</strong> won't receive marketing emails from Technohana any more. Changed your mind? You can subscribe again at <a href="${escapeHtml(siteUrl)}" style="color:#7C3AED;">technohana.in</a>.</p>`
      )
    );
  } catch (err) {
    console.error('Unsubscribe error:', err);
    return res.status(500).type('html').send(
      unsubscribePage(
        'Something went wrong',
        `<p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">We couldn't process that just now. Please try again, or email <a href="mailto:unsubscribe@technohana.in" style="color:#7C3AED;">unsubscribe@technohana.in</a>.</p>`
      )
    );
  }
};
