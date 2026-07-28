import express from "express";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import Enquiry from "../models/enquiry.model.js";
import { Blogs } from "../models/blogs.model.js";
import { CourseView } from "../models/courseView.model.js";
import { authenticateAdmin, requirePage } from "../middleware/authenticateAdmin.js";
import { getGA4AdminClient, getGA4PropertyPath } from "../config/googleAnalytics.js";

const router = express.Router();

const GA4_NOT_CONFIGURED_MESSAGE =
  "GA4 isn't connected yet. Add GOOGLE_SERVICE_ACCOUNT_KEY and GA4_PROPERTY_ID — see GA4_KEY_EVENTS_SETUP.md.";

const shapeKeyEvent = (keyEvent) => ({
  id: keyEvent.name?.split("/").pop(),
  eventName: keyEvent.eventName,
  countingMethod: keyEvent.countingMethod,
  custom: keyEvent.custom,
  createTime: keyEvent.createTime,
});

const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

const parseDateRange = (req, res) => {
  const { from, to } = req.query;
  if (from && !isValidDate(from)) {
    res.status(400).json({ message: "Invalid 'from' date. Use YYYY-MM-DD." });
    return null;
  }
  if (to && !isValidDate(to)) {
    res.status(400).json({ message: "Invalid 'to' date. Use YYYY-MM-DD." });
    return null;
  }
  const makeDateFilter = (field) => {
    const f = {};
    if (from) f.$gte = new Date(from);
    if (to) f.$lte = new Date(to + "T23:59:59.999Z");
    return Object.keys(f).length ? { [field]: f } : {};
  };
  return { from, to, makeDateFilter };
};

const CURRENCY_TO_REGION = {
  INR: { label: "India", flag: "🇮🇳", region: "South Asia" },
  USD: { label: "United States", flag: "🇺🇸", region: "North America" },
  GBP: { label: "United Kingdom", flag: "🇬🇧", region: "Europe" },
  EUR: { label: "Europe", flag: "🇪🇺", region: "Europe" },
  AED: { label: "UAE", flag: "🇦🇪", region: "Middle East" },
  SGD: { label: "Singapore", flag: "🇸🇬", region: "Southeast Asia" },
  AUD: { label: "Australia", flag: "🇦🇺", region: "Oceania" },
  CAD: { label: "Canada", flag: "🇨🇦", region: "North America" },
  MYR: { label: "Malaysia", flag: "🇲🇾", region: "Southeast Asia" },
  SAR: { label: "Saudi Arabia", flag: "🇸🇦", region: "Middle East" },
  QAR: { label: "Qatar", flag: "🇶🇦", region: "Middle East" },
  KWD: { label: "Kuwait", flag: "🇰🇼", region: "Middle East" },
  BHD: { label: "Bahrain", flag: "🇧🇭", region: "Middle East" },
  OMR: { label: "Oman", flag: "🇴🇲", region: "Middle East" },
  NPR: { label: "Nepal", flag: "🇳🇵", region: "South Asia" },
  LKR: { label: "Sri Lanka", flag: "🇱🇰", region: "South Asia" },
  BDT: { label: "Bangladesh", flag: "🇧🇩", region: "South Asia" },
  ZAR: { label: "South Africa", flag: "🇿🇦", region: "Africa" },
  NGN: { label: "Nigeria", flag: "🇳🇬", region: "Africa" },
};

// ── GET /admin/geo-analytics ──────────────────────────────────────────────────
router.get("/geo-analytics", authenticateAdmin, requirePage("geo-analysis"), async (req, res) => {
  try {
    const range = parseDateRange(req, res);
    if (!range) return;
    const { makeDateFilter } = range;

    const [enrollmentsByCurrency, revenuesByCurrency, enquiriesByCurrency, pageViewsByCountry] =
      await Promise.all([
        User.aggregate([
          {
            $match: {
              status: { $in: ["enrolled", "in-progress", "completed"] },
              ...makeDateFilter("enrolledAt"),
            },
          },
          {
            $group: {
              _id: { $ifNull: ["$currency", "INR"] },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),

        Order.aggregate([
          { $match: { status: "paid", ...makeDateFilter("createdAt") } },
          {
            $group: {
              _id: {
                $toUpper: { $ifNull: ["$currency", "INR"] },
              },
              orders: { $sum: 1 },
              totalMinor: { $sum: "$expectedTotalMinor" },
            },
          },
          { $sort: { orders: -1 } },
        ]),

        Enquiry.aggregate([
          { $match: { ...makeDateFilter("createdAt") } },
          {
            $group: {
              _id: { $ifNull: ["$currency", "INR"] },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),

        CourseView.aggregate([
          { $match: { country: { $ne: null }, ...makeDateFilter("viewedAt") } },
          { $group: { _id: "$country", views: { $sum: 1 } } },
          { $sort: { views: -1 } },
          { $limit: 10 },
        ]),
      ]);

    const allCurrencies = [
      ...new Set([
        ...enrollmentsByCurrency.map((r) => String(r._id).toUpperCase()),
        ...revenuesByCurrency.map((r) => String(r._id).toUpperCase()),
        ...enquiriesByCurrency.map((r) => String(r._id).toUpperCase()),
      ]),
    ];

    const rows = allCurrencies.map((currency) => {
      const enr = enrollmentsByCurrency.find(
        (r) => String(r._id).toUpperCase() === currency
      );
      const rev = revenuesByCurrency.find(
        (r) => String(r._id).toUpperCase() === currency
      );
      const enq = enquiriesByCurrency.find(
        (r) => String(r._id).toUpperCase() === currency
      );
      const meta = CURRENCY_TO_REGION[currency] || {
        label: currency,
        flag: "🌍",
        region: "Other",
      };
      return {
        currency,
        ...meta,
        enrollments: enr?.count || 0,
        orders: rev?.orders || 0,
        revenueMinor: rev?.totalMinor || 0,
        enquiries: enq?.count || 0,
      };
    });

    rows.sort(
      (a, b) => b.enrollments + b.enquiries - (a.enrollments + a.enquiries)
    );

    const summary = {
      totalCountries: rows.length,
      totalEnrollments: rows.reduce((s, r) => s + r.enrollments, 0),
      totalOrders: rows.reduce((s, r) => s + r.orders, 0),
      totalEnquiries: rows.reduce((s, r) => s + r.enquiries, 0),
      totalRevenueMinor: rows.reduce((s, r) => s + r.revenueMinor, 0),
      topCountry: rows[0]?.label || "—",
      topCountryFlag: rows[0]?.flag || "🌍",
    };

    res.json({
      rows,
      summary,
      pageViewsByCountry: pageViewsByCountry.map((r) => ({ country: r._id, views: r.views })),
    });
  } catch (err) {
    console.error("geo-analytics error:", err);
    res.status(500).json({ error: "Failed to load geo analytics" });
  }
});

// ── GET /admin/seo-analytics ──────────────────────────────────────────────────
router.get("/seo-analytics", authenticateAdmin, requirePage("seo-analysis"), async (req, res) => {
  try {
    const range = parseDateRange(req, res);
    if (!range) return;
    const { makeDateFilter } = range;

    const blogs = await Blogs.find(
      {},
      {
        title: 1,
        slug: 1,
        metaTitle: 1,
        metaDescription: 1,
        focusKeyword: 1,
        excerpt: 1,
        published: 1,
        tags: 1,
        date: 1,
        readTimeMin: 1,
        category: 1,
        content: 1,
      }
    ).lean();

    const blogAudit = blogs.map((blog) => {
      const mt = blog.metaTitle || blog.title || "";
      const md = blog.metaDescription || blog.excerpt || "";
      const hasKeyword = !!(blog.focusKeyword);
      const hasTags = (blog.tags || []).length > 0;
      const titleLength = mt.length;
      const descLength = md.length;

      let score = 0;
      if (titleLength >= 30 && titleLength <= 60) score += 30;
      else if (titleLength > 0) score += 10;
      if (descLength >= 120 && descLength <= 160) score += 30;
      else if (descLength >= 80) score += 15;
      else if (descLength > 0) score += 5;
      if (hasKeyword) score += 20;
      if (hasTags) score += 10;
      if (blog.published) score += 10;

      const issues = [];
      if (titleLength === 0) issues.push("Missing meta title");
      else if (titleLength < 30) issues.push("Title too short (<30 chars)");
      else if (titleLength > 60) issues.push("Title too long (>60 chars)");
      if (descLength === 0) issues.push("Missing meta description");
      else if (descLength < 80) issues.push("Description too short (<80 chars)");
      else if (descLength > 160)
        issues.push("Description too long (>160 chars)");
      if (!hasKeyword) issues.push("No focus keyword");
      if (!hasTags) issues.push("No tags");

      return {
        _id: blog._id,
        title: blog.title,
        slug: blog.slug,
        metaTitle: blog.metaTitle,
        metaDescription: blog.metaDescription,
        focusKeyword: blog.focusKeyword,
        published: blog.published,
        category: blog.category,
        content: blog.content,
        readTimeMin: blog.readTimeMin,
        titleLength,
        descLength,
        hasKeyword,
        hasTags,
        score,
        issues,
      };
    });

    blogAudit.sort((a, b) => a.score - b.score);

    const enquiryDateFilter = makeDateFilter("createdAt");

    const [organic, paid, social, total] = await Promise.all([
      Enquiry.countDocuments({ "utm.medium": "organic", ...enquiryDateFilter }),
      Enquiry.countDocuments({
        "utm.medium": { $in: ["cpc", "paid", "ppc", "paidsearch"] },
        ...enquiryDateFilter,
      }),
      Enquiry.countDocuments({
        "utm.medium": { $in: ["social", "social-media", "referral"] },
        ...enquiryDateFilter,
      }),
      Enquiry.countDocuments({ ...enquiryDateFilter }),
    ]);

    const other = Math.max(0, total - organic - paid - social);
    const trafficSplit = { organic, paid, social, other, total };

    const organicSources = await Enquiry.aggregate([
      { $match: { "utm.medium": "organic", ...enquiryDateFilter } },
      {
        $group: {
          _id: { $ifNull: ["$utm.source", "(unknown)"] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const topPages = await CourseView.aggregate([
      { $match: makeDateFilter("viewedAt") },
      {
        $group: {
          _id: "$courseId",
          courseTitle: { $last: "$courseTitle" },
          views: { $sum: 1 },
          uniqueEmails: {
            $addToSet: {
              $cond: [{ $ifNull: ["$userEmail", false] }, "$userEmail", "$$REMOVE"],
            },
          },
        },
      },
      { $sort: { views: -1 } },
      { $limit: 10 },
      {
        $project: {
          courseId: "$_id",
          courseTitle: 1,
          views: 1,
          uniqueViewers: { $size: "$uniqueEmails" },
          _id: 0,
        },
      },
    ]);

    const summary = {
      totalBlogs: blogs.length,
      publishedBlogs: blogs.filter((b) => b.published).length,
      avgScore:
        Math.round(
          blogAudit.reduce((s, b) => s + b.score, 0) / (blogs.length || 1)
        ),
      goodSEO: blogAudit.filter((b) => b.score >= 70).length,
      needsWork: blogAudit.filter((b) => b.score < 40).length,
    };

    res.json({ blogAudit, trafficSplit, organicSources, topPages, summary });
  } catch (err) {
    console.error("seo-analytics error:", err);
    res.status(500).json({ error: "Failed to load SEO analytics" });
  }
});

// ── GA4 Key Events ────────────────────────────────────────────────────────────

router.get("/ga4-key-events", authenticateAdmin, requirePage("seo-analysis"), async (req, res) => {
  try {
    const client = getGA4AdminClient();
    const [keyEvents] = await client.listKeyEvents({ parent: getGA4PropertyPath() });
    res.json({ success: true, data: (keyEvents || []).map(shapeKeyEvent) });
  } catch (err) {
    console.error("ga4-key-events list error:", err.message);
    if (err.code === "GA4_NOT_CONFIGURED") {
      return res.status(501).json({ success: false, message: GA4_NOT_CONFIGURED_MESSAGE });
    }
    res.status(500).json({ success: false, message: "Failed to load GA4 key events." });
  }
});

router.post("/ga4-key-events", authenticateAdmin, requirePage("seo-analysis"), async (req, res) => {
  const { eventName, countingMethod = "ONCE_PER_EVENT" } = req.body;
  if (!eventName) {
    return res.status(400).json({ success: false, message: "eventName is required." });
  }
  try {
    const client = getGA4AdminClient();
    const [keyEvent] = await client.createKeyEvent({
      parent: getGA4PropertyPath(),
      keyEvent: { eventName, countingMethod },
    });
    res.status(201).json({ success: true, data: shapeKeyEvent(keyEvent) });
  } catch (err) {
    console.error("ga4-key-events create error:", err.message);
    if (err.code === "GA4_NOT_CONFIGURED") {
      return res.status(501).json({ success: false, message: GA4_NOT_CONFIGURED_MESSAGE });
    }
    res.status(500).json({ success: false, message: "Failed to create GA4 key event." });
  }
});

router.delete("/ga4-key-events/:keyEventId", authenticateAdmin, requirePage("seo-analysis"), async (req, res) => {
  try {
    const client = getGA4AdminClient();
    await client.deleteKeyEvent({ name: `${getGA4PropertyPath()}/keyEvents/${req.params.keyEventId}` });
    res.json({ success: true, message: "Key event removed." });
  } catch (err) {
    console.error("ga4-key-events delete error:", err.message);
    if (err.code === "GA4_NOT_CONFIGURED") {
      return res.status(501).json({ success: false, message: GA4_NOT_CONFIGURED_MESSAGE });
    }
    res.status(500).json({ success: false, message: "Failed to delete GA4 key event." });
  }
});

export default router;
