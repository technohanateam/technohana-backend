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

    // Compose email
    const formDataStr =
      user.enrollmentFormData && Object.keys(user.enrollmentFormData).length > 0
        ? Object.entries(user.enrollmentFormData)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
        : "No form data available"

    const emailTemplate = `
        <h2>You Left Something Behind!</h2>
        <p>Hi ${user.name || "there"},</p>
        <p>We noticed you started an enrollment but didn't finish. We'd love to help you complete your course registration!</p>
        
        <h3>Your Form Details:</h3>
        <pre>${formDataStr}</pre>
        
        <p>
            <a href="${process.env.FRONTEND_URL}/my-enrollments" 
               style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                Resume Your Enrollment
            </a>
        </p>
        
        <p>If you have any questions, feel free to reach out to our support team.</p>
        <p>Best regards,<br>TechnoHana Team</p>
        `

    // Send email
    await sendEmail(
      email,
      "You Left Something Behind! Resume Your Enrollment",
      emailTemplate
    )

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
