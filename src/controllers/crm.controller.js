import Enquiry from "../models/enquiry.model.js";
import Lead from "../models/lead.model.js";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import Campaign from "../models/campaign.model.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Sentinel date used so $min ignores records with no follow-up (null < any Date in BSON order)
const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");

export const getContacts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const { search, type, aiBand } = req.query;

    const pipeline = [
      // ── Normalize Lead docs ──────────────────────────────────────────────────
      {
        $project: {
          email: { $toLower: "$email" },
          name: 1,
          company: { $literal: null },
          phone: { $literal: null },
          _sourceType: { $literal: "lead" },
          aiScore: { $literal: null },
          aiScoreBand: { $literal: null },
          status: { $literal: null },
          assignedTo: { $literal: null },
          nextFollowUp: { $literal: FAR_FUTURE },
          createdAt: 1,
        },
      },
      // ── Union with Enquiries ─────────────────────────────────────────────────
      {
        $unionWith: {
          coll: "enquiries",
          pipeline: [
            {
              $project: {
                email: { $toLower: "$email" },
                name: 1,
                company: 1,
                phone: 1,
                _sourceType: { $literal: "enquiry" },
                aiScore: 1,
                aiScoreBand: 1,
                status: 1,
                assignedTo: 1,
                nextFollowUp: { $ifNull: ["$nextFollowUp", FAR_FUTURE] },
                createdAt: 1,
              },
            },
          ],
        },
      },
      // ── Union with Users ─────────────────────────────────────────────────────
      {
        $unionWith: {
          coll: "users",
          pipeline: [
            {
              $project: {
                email: { $toLower: "$email" },
                name: 1,
                company: 1,
                phone: 1,
                _sourceType: { $literal: "user" },
                aiScore: { $literal: null },
                aiScoreBand: { $literal: null },
                status: "$status",
                assignedTo: { $literal: null },
                nextFollowUp: { $literal: FAR_FUTURE },
                createdAt: { $ifNull: ["$enrolledAt", { $toDate: "$_id" }] },
              },
            },
          ],
        },
      },
      // ── Group by email ───────────────────────────────────────────────────────
      {
        $group: {
          _id: "$email",
          email: { $first: "$email" },
          name: { $first: "$name" },
          company: { $max: "$company" },
          phone: { $max: "$phone" },
          aiScore: { $max: "$aiScore" },
          aiScoreBandRank: {
            $max: {
              $switch: {
                branches: [
                  { case: { $eq: ["$aiScoreBand", "hot"] }, then: 3 },
                  { case: { $eq: ["$aiScoreBand", "warm"] }, then: 2 },
                  { case: { $eq: ["$aiScoreBand", "cold"] }, then: 1 },
                ],
                default: 0,
              },
            },
          },
          _hasUser: {
            $max: { $cond: [{ $eq: ["$_sourceType", "user"] }, 1, 0] },
          },
          _hasEnquiry: {
            $max: { $cond: [{ $eq: ["$_sourceType", "enquiry"] }, 1, 0] },
          },
          status: { $max: "$status" },
          assignedTo: { $max: "$assignedTo" },
          nextFollowUp: { $min: "$nextFollowUp" },
          lastActivity: { $max: "$createdAt" },
        },
      },
      // ── Derive type, aiScoreBand, and normalize nextFollowUp sentinel ────────
      {
        $addFields: {
          type: {
            $cond: [
              { $eq: ["$_hasUser", 1] },
              "customer",
              { $cond: [{ $eq: ["$_hasEnquiry", 1] }, "prospect", "lead"] },
            ],
          },
          aiScoreBand: {
            $switch: {
              branches: [
                { case: { $eq: ["$aiScoreBandRank", 3] }, then: "hot" },
                { case: { $eq: ["$aiScoreBandRank", 2] }, then: "warm" },
                { case: { $eq: ["$aiScoreBandRank", 1] }, then: "cold" },
              ],
              default: null,
            },
          },
          // Convert sentinel back to null if no real follow-up was found
          nextFollowUp: {
            $cond: [
              { $lt: ["$nextFollowUp", FAR_FUTURE] },
              "$nextFollowUp",
              null,
            ],
          },
        },
      },
    ];

    // ── Filters (post-group) ─────────────────────────────────────────────────
    const matchStage = {};
    if (type && type !== "all") matchStage.type = type;
    if (aiBand && aiBand !== "all") matchStage.aiScoreBand = aiBand;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      matchStage.$or = [{ email: rx }, { name: rx }, { company: rx }];
    }
    if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });

    pipeline.push({ $sort: { lastActivity: -1 } });

    pipeline.push({
      $facet: {
        total: [{ $count: "count" }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              email: 1,
              name: 1,
              company: 1,
              phone: 1,
              type: 1,
              aiScore: 1,
              aiScoreBand: 1,
              status: 1,
              lastActivity: 1,
              assignedTo: 1,
              nextFollowUp: 1,
            },
          },
        ],
      },
    });

    const [result] = await Lead.aggregate(pipeline);
    const total = result?.total?.[0]?.count ?? 0;
    const data = result?.data ?? [];

    return res.json({ success: true, data, total, page, limit });
  } catch (err) {
    console.error("getContacts error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch contacts" });
  }
};

export const getContactProfile = async (req, res) => {
  try {
    const email = req.params.email?.toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const emailRegex = new RegExp(`^${escapeRegex(email)}$`, "i");

    const [enquiries, enrollments, orders, lead, campaigns] = await Promise.all([
      Enquiry.find({ email: emailRegex }).sort({ createdAt: -1 }).lean(),
      User.find({ email: emailRegex }).sort({ createdAt: -1 }).lean(),
      Order.find({ "learner.email": emailRegex }).sort({ createdAt: -1 }).lean(),
      Lead.findOne({ email: emailRegex }).lean(),
      Campaign.find({ "recipientMetrics.email": emailRegex }, { name: 1, recipientMetrics: 1, sentAt: 1 }).lean(),
    ]);

    // ── Merge best identity fields ───────────────────────────────────────────
    const bestEnquiry = enquiries[0] || {};
    const bestUser = enrollments[0] || {};
    const name = bestEnquiry.name || bestUser.name || lead?.name || "";
    const company = bestEnquiry.company || bestUser.company || null;
    const phone = bestEnquiry.phone || bestUser.phone || null;
    const utm = bestEnquiry.utm || bestUser.utm || lead?.utm || null;
    const source = bestEnquiry.source || lead?.source || null;

    const topEnquiry = enquiries.find((e) => e.aiScore != null) || enquiries[0] || {};
    const type = enrollments.length > 0 ? "customer" : enquiries.length > 0 ? "prospect" : "lead";

    // ── Campaign interactions ────────────────────────────────────────────────
    const campaignInteractions = [];
    for (const c of campaigns) {
      const metric = c.recipientMetrics?.find(
        (m) => m.email?.toLowerCase() === email
      );
      if (metric) {
        campaignInteractions.push({
          campaignId: c._id,
          campaignName: c.name,
          sentAt: metric.sentAt || c.sentAt || null,
          openedAt: metric.openedAt || null,
          clickedAt: metric.clickedAt || null,
          status: metric.status || "sent",
        });
      }
    }

    // ── Build timeline ───────────────────────────────────────────────────────
    const timeline = [];

    for (const e of enquiries) {
      timeline.push({
        type: "enquiry_created",
        at: e.createdAt,
        label: `Enquiry submitted for ${e.courseTitle || "a course"}`,
        meta: { enquiryId: e._id, status: e.status },
      });
    }

    for (const u of enrollments) {
      const ts = u.createdAt || new Date(parseInt(u._id.toString().slice(0, 8), 16) * 1000);
      timeline.push({
        type: "enrollment_started",
        at: ts,
        label: `Enrollment started for ${u.courseTitle || "a course"}`,
        meta: { userId: u._id, status: u.status },
      });
      if (u.enrolledAt) {
        timeline.push({
          type: "enrolled",
          at: u.enrolledAt,
          label: `Enrolled in ${u.courseTitle || "a course"}`,
          meta: { userId: u._id },
        });
      }
    }

    for (const o of orders) {
      timeline.push({
        type: "order_placed",
        at: new Date(o.paidAt || o.createdAt),
        label: `Payment received for ${o.courseInfo?.courseTitle || o.courseId || "a course"}`,
        meta: { orderId: o.orderId, total: o.expectedTotalMinor, currency: o.currency },
      });
    }

    if (lead) {
      timeline.push({
        type: "lead_captured",
        at: lead.createdAt,
        label: `Lead captured via ${lead.persona || lead.source || "persona page"}`,
        meta: { persona: lead.persona, source: lead.source },
      });
    }

    for (const ci of campaignInteractions) {
      if (ci.openedAt) {
        timeline.push({
          type: "campaign_opened",
          at: ci.openedAt,
          label: `Opened email: ${ci.campaignName}`,
          meta: { campaignId: ci.campaignId },
        });
      }
      if (ci.clickedAt) {
        timeline.push({
          type: "campaign_clicked",
          at: ci.clickedAt,
          label: `Clicked link in: ${ci.campaignName}`,
          meta: { campaignId: ci.campaignId },
        });
      }
    }

    timeline.sort((a, b) => new Date(b.at) - new Date(a.at));

    const profile = {
      email,
      name,
      company,
      phone,
      type,
      source,
      utm,
      aiScore: topEnquiry.aiScore ?? null,
      aiScoreBand: topEnquiry.aiScoreBand ?? null,
      aiReasoning: topEnquiry.aiReasoning ?? null,
      assignedTo: topEnquiry.assignedTo ?? null,
      nextFollowUp: enquiries.find((e) => e.nextFollowUp)?.nextFollowUp ?? null,
      enquiries: enquiries.map((e) => ({
        _id: e._id,
        courseTitle: e.courseTitle,
        enquiryType: e.enquiryType,
        status: e.status,
        aiScore: e.aiScore ?? null,
        aiScoreBand: e.aiScoreBand ?? null,
        notes: e.notes,
        assignedTo: e.assignedTo,
        nextFollowUp: e.nextFollowUp ?? null,
        createdAt: e.createdAt,
        activities: e.activities || [],
      })),
      enrollments: enrollments.map((u) => ({
        _id: u._id,
        courseTitle: u.courseTitle,
        status: u.status,
        enrolledAt: u.enrolledAt ?? null,
        progress: u.progress ?? 0,
        trainingType: u.trainingType,
        certificateIssued: u.certificateIssued ?? false,
        completedAt: u.completedAt ?? null,
      })),
      orders: orders.map((o) => ({
        _id: o._id,
        orderId: o.orderId,
        invoiceNumber: o.invoiceNumber,
        courseInfo: o.courseInfo,
        expectedTotalMinor: o.expectedTotalMinor,
        currency: o.currency,
        provider: o.provider,
        paidAt: o.paidAt,
        totalDiscountPercent: o.totalDiscountPercent,
        createdAt: o.createdAt,
      })),
      lead: lead
        ? { persona: lead.persona, source: lead.source, createdAt: lead.createdAt }
        : null,
      campaignInteractions,
      timeline,
    };

    return res.json({ success: true, data: profile });
  } catch (err) {
    console.error("getContactProfile error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch contact profile" });
  }
};
