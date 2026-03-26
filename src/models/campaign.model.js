import mongoose, { Schema } from "mongoose";

const campaignSchema = new Schema({
  // Basic Info
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },

  // Email Content
  subject: {
    type: String,
    required: true,
  },
  htmlContent: {
    type: String,
    required: true, // Full HTML email template
  },
  previewText: {
    type: String, // Preview shown in inbox
  },
  fromName: {
    type: String,
    default: "Technohana",
  },
  fromEmail: {
    type: String,
    default: "noreply@technohana.in",
  },

  // A/B Testing Variants
  variants: [
    {
      name: String, // e.g., "Subject Line A", "Subject Line B"
      subject: String,
      htmlContent: String,
      weight: { type: Number, default: 50 }, // % of audience to test
    },
  ],

  // Audience Segmentation
  segments: {
    enrolledUsers: { type: Boolean, default: false },
    courseIds: [String], // Specific courses
    referralPartners: { type: Boolean, default: false },
    inactiveUsers: {
      type: Boolean,
      default: false,
      // Inactive = no login in last 30 days
    },
    abandonedEnrollments: { type: Boolean, default: false },
    customFilters: [
      {
        field: String, // e.g., "status", "enrolledAt"
        operator: String, // "equals", "gt", "lt", "regex"
        value: mongoose.Schema.Types.Mixed,
      },
    ],
  },

  // Automation Rules
  triggerType: {
    type: String,
    enum: [
      "manual", // User clicks send
      "schedule", // One-time scheduled send
      "recurring", // Repeats on schedule
      "event", // Triggered by user action (enrollment, referral, etc.)
    ],
    default: "manual",
  },
  schedule: {
    // For "schedule" and "recurring" triggers
    sendAt: Date, // One-time send
    cronExpression: String, // e.g., "0 9 * * MON" for every Monday at 9 AM
    timezone: { type: String, default: "UTC" },
    recurrenceEnd: Date, // When to stop recurring
  },
  eventTrigger: {
    // For "event" trigger type
    event: String, // "enrollment_complete", "referral_made", "inactive_30days", "abandoned_3days"
    delayMinutes: { type: Number, default: 0 }, // Wait X minutes before sending
  },

  // Campaign Status & Control
  status: {
    type: String,
    enum: ["draft", "scheduled", "running", "paused", "completed", "failed"],
    default: "draft",
  },
  isPaused: { type: Boolean, default: false },
  pausedAt: Date,
  resumedAt: Date,

  // Resend Integration
  resendCampaignId: String, // ID returned by Resend for tracking


  // Metrics & Tracking
  metrics: {
    totalSent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    unsubscribed: { type: Number, default: 0 },
    complained: { type: Number, default: 0 },
  },
  recipientMetrics: [
    {
      userId: mongoose.Schema.Types.ObjectId,
      email: String,
      status: String, // "sent", "delivered", "bounced", "failed"
      openedAt: Date,
      clickedAt: Date,
      clickUrl: String,
      variant: String, // Which A/B variant was sent
      sentAt: Date,
    },
  ],

  // Retry & Error Handling
  lastError: String,
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },
  lastRetryAt: Date,

  // Admin & Audit
  createdBy: mongoose.Schema.Types.ObjectId,
  createdByRole: { type: String, enum: ["admin", "marketing", "sales"] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  sentAt: Date,
  completedAt: Date,
});

// Update updatedAt on save
campaignSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Calculate metrics when queried
campaignSchema.methods.calculateMetrics = function () {
  if (!this.recipientMetrics || this.recipientMetrics.length === 0) {
    return {
      openRate: 0,
      clickRate: 0,
      bounceRate: 0,
      deliveryRate: 0,
    };
  }

  const total = this.metrics.totalSent;
  return {
    openRate: total > 0 ? ((this.metrics.opened / total) * 100).toFixed(2) : 0,
    clickRate: total > 0 ? ((this.metrics.clicked / total) * 100).toFixed(2) : 0,
    bounceRate: total > 0 ? ((this.metrics.bounced / total) * 100).toFixed(2) : 0,
    deliveryRate:
      total > 0 ? ((this.metrics.delivered / total) * 100).toFixed(2) : 0,
  };
};

const Campaign = mongoose.model("Campaign", campaignSchema);
export default Campaign;
