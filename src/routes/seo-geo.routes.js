import express from "express";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import Enquiry from "../models/enquiry.model.js";
import { Blogs } from "../models/blogs.model.js";
import { CourseView } from "../models/courseView.model.js";
import { authenticateAdmin } from "../middleware/authenticateAdmin.js";

const router = express.Router();

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
router.get("/geo-analytics", authenticateAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;

    const makeDateFilter = (field) => {
      const f = {};
      if (from) f.$gte = new Date(from);
      if (to) f.$lte = new Date(to + "T23:59:59.999Z");
      return Object.keys(f).length ? { [field]: f } : {};
    };

    const [enrollmentsByCurrency, revenuesByCurrency, enquiriesByCurrency] =
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
      topCountry: rows[0]?.label || "—",
      topCountryFlag: rows[0]?.flag || "🌍",
    };

    res.json({ rows, summary });
  } catch (err) {
    console.error("geo-analytics error:", err);
    res.status(500).json({ error: "Failed to load geo analytics" });
  }
});

// ── GET /admin/seo-analytics ──────────────────────────────────────────────────
router.get("/seo-analytics", authenticateAdmin, async (req, res) => {
  try {
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

    const [organic, paid, social, total] = await Promise.all([
      Enquiry.countDocuments({ "utm.medium": "organic" }),
      Enquiry.countDocuments({
        "utm.medium": { $in: ["cpc", "paid", "ppc", "paidsearch"] },
      }),
      Enquiry.countDocuments({
        "utm.medium": { $in: ["social", "social-media", "referral"] },
      }),
      Enquiry.countDocuments({}),
    ]);

    const other = Math.max(0, total - organic - paid - social);
    const trafficSplit = { organic, paid, social, other, total };

    const organicSources = await Enquiry.aggregate([
      { $match: { "utm.medium": "organic" } },
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
      {
        $group: {
          _id: "$courseId",
          views: { $sum: 1 },
          uniqueViewers: { $addToSet: "$visitorId" },
        },
      },
      {
        $project: {
          courseId: "$_id",
          views: 1,
          uniqueViewers: { $size: "$uniqueViewers" },
        },
      },
      { $sort: { views: -1 } },
      { $limit: 10 },
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

export default router;
