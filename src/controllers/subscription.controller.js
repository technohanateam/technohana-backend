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
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e40af;">Welcome to Technohana!</h2>
          <p>Thank you for subscribing to our newsletter. You'll now receive updates about:</p>
          <ul>
            <li>Latest AI courses and training programs</li>
            <li>Industry insights and trends</li>
            <li>Upcoming events and webinars</li>
            <li>Exclusive offers and discounts</li>
          </ul>
          <p>Stay tuned for valuable content delivered straight to your inbox!</p>
          <p>Best regards,<br>The Technohana Team</p>
        </div>`,
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
        const mailOptions = {
          from: process.env.MAIL_FROM || 'no-reply@technohana.in',
          to: subscriber.email,
          subject: subject,
          text: content,
          html: htmlContent || `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1e40af;">Technohana Newsletter</h2>
              <div style="line-height: 1.6;">
                ${content ? content.replace(/\n/g, '<br>') : ''}
              </div>
              <hr style="margin: 20px 0;">
              <p style="color: #666; font-size: 12px;">
                You're receiving this email because you subscribed to our newsletter.<br>
                To unsubscribe, please contact us.
              </p>
            </div>
          `,
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