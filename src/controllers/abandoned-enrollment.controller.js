import { User } from "../models/user.model.js"
import { sendEmail } from "../config/emailService.js"

// Save enrollment form progress (called on every field change)
export const saveEnrollmentFormProgress = async (req, res) => {
  try {
    const email = req.user?.email
    if (!email) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    const { formData } = req.body
    if (!formData || typeof formData !== "object") {
      return res.status(400).json({ message: "Form data is required" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Save form progress locally
    user.enrollmentFormData = formData
    user.enrollmentFormStartedAt = user.enrollmentFormStartedAt || new Date()
    user.enrollmentFormAbandonedAt = null // Clear abandoned flag when user continues

    await user.save()

    res.status(200).json({
      message: "Form progress saved successfully"
    })
  } catch (error) {
    console.error("Error saving enrollment form progress:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}

// Mark enrollment form as abandoned and send reminder email
export const markFormAbandoned = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) {
      return res.status(400).json({ message: "Email is required" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Only mark as abandoned if there's form data (they started the form)
    if (!user.enrollmentFormData || Object.keys(user.enrollmentFormData).length === 0) {
      return res.status(400).json({ message: "No form data found to mark as abandoned" })
    }

    user.enrollmentFormAbandonedAt = new Date()

    await user.save()

    // Optionally send reminder email (will be done by scheduled job or manual trigger)
    res.status(200).json({
      message: "Form marked as abandoned successfully"
    })
  } catch (error) {
    console.error("Error marking form as abandoned:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}

// Send enrollment reminder email
export const sendEnrollmentReminder = async (req, res) => {
  try {
    const email = req.user?.email || req.body?.email
    if (!email) {
      return res.status(400).json({ message: "Email is required" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Check if form is abandoned
    if (!user.enrollmentFormAbandonedAt) {
      return res.status(400).json({ message: "Form is not marked as abandoned" })
    }

    // Check if reminder already sent in last 24 hours
    if (user.enrollmentReminderSent && user.enrollmentReminderSentAt) {
      const hoursSinceReminder =
        (new Date() - user.enrollmentReminderSentAt) / (1000 * 60 * 60)
      if (hoursSinceReminder < 24) {
        return res.status(400).json({
          message: "Reminder already sent recently. Please try again later."
        })
      }
    }

    // Build branded form data table rows
    const formFields = user.enrollmentFormData && Object.keys(user.enrollmentFormData).length > 0
      ? Object.entries(user.enrollmentFormData)
      : []

    const formRows = formFields.length > 0
      ? formFields.map(([key, value], i) => {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
          const bg = i % 2 === 1 ? '#f0f7ff' : '#ffffff'
          return `<tr>
            <td style="padding:10px 12px;background:${bg};border-bottom:1px solid #e2e8f0;width:40%;font-size:13px;font-weight:600;color:#475569;">${label}</td>
            <td style="padding:10px 12px;background:${bg};border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${value || '—'}</td>
          </tr>`
        }).join('')
      : `<tr><td colspan="2" style="padding:12px;font-size:13px;color:#64748b;text-align:center;">No form data available</td></tr>`

    const subject = "You Left Something Behind! Resume Your Enrollment"
    const html = `<!DOCTYPE html>
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
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#93c5fd;text-transform:uppercase;">Enrollment Recovery</p>
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Technohana</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">You left something behind${user.name ? `, ${user.name}` : ''}!</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">We noticed you started an enrollment but didn't finish. Your progress is saved — pick up right where you left off.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:28px;">
                ${formRows}
              </table>
              <div style="text-align:center;">
                <a href="${process.env.FRONTEND_URL || 'https://technohana.in'}/my-enrollments" style="display:inline-block;background:#27A8F5;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:8px;">Resume My Enrollment →</a>
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
</html>`

    // Send email
    await sendEmail({ from: 'Sales <sales@technohana.in>', to: email, subject, html })

    // Update user document
    user.enrollmentReminderSent = true
    user.enrollmentReminderSentAt = new Date()
    await user.save()

    res.status(200).json({
      message: "Reminder email sent successfully"
    })
  } catch (error) {
    console.error("Error sending enrollment reminder:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}

// Get abandoned enrollments (admin endpoint - check if form exists)
export const getAbandonedEnrollments = async (req, res) => {
  try {
    // Only allow admin access (optional - adjust based on your auth)
    const abandonedUsers = await User.find(
      {
        enrollmentFormAbandonedAt: { $ne: null },
        enrollmentReminderSent: false
      },
      {
        email: 1,
        name: 1,
        enrollmentFormStartedAt: 1,
        enrollmentFormAbandonedAt: 1
      }
    )

    res.status(200).json({
      count: abandonedUsers.length,
      users: abandonedUsers
    })
  } catch (error) {
    console.error("Error getting abandoned enrollments:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}

// Clear enrollment form data after successful enrollment
export const clearEnrollmentFormData = async (req, res) => {
  try {
    const email = req.user?.email
    if (!email) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Clear all enrollment form related data
    user.enrollmentFormData = null
    user.enrollmentFormStartedAt = null
    user.enrollmentFormAbandonedAt = null
    user.enrollmentReminderSent = false
    user.enrollmentReminderSentAt = null

    await user.save()

    res.status(200).json({
      message: "Enrollment form data cleared successfully"
    })
  } catch (error) {
    console.error("Error clearing enrollment form data:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}

// Get enrollment form progress (to resume form)
export const getEnrollmentFormProgress = async (req, res) => {
  try {
    const email = req.user?.email
    if (!email) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    const user = await User.findOne(
      { email },
      {
        enrollmentFormData: 1,
        enrollmentFormStartedAt: 1,
        enrollmentFormAbandonedAt: 1
      }
    )
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    res.status(200).json({
      formData: user.enrollmentFormData || {},
      startedAt: user.enrollmentFormStartedAt,
      abandonedAt: user.enrollmentFormAbandonedAt
    })
  } catch (error) {
    console.error("Error getting enrollment form progress:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}
