import ContentOpportunity from "../../models/contentOpportunity.model.js";
import { Blogs } from "../../models/blogs.model.js";

// ── Existing scheduling semantics (confirmed by reading blog.controller.js's
// public getAllBlogs()/getBlogBySlug() and admin.routes.js's PATCH
// /blogs/:id/publish + POST /blogs/auto-schedule before writing this file) ──
//
// There is NO cron/background job that flips `published` when `scheduledAt`
// arrives. The public read paths gate visibility purely at query time:
//   Blogs.find({ published: true, $or: [{scheduledAt:null},{scheduledAt:{$lte:now}}] })
// So a post only ever "goes live at scheduledAt" if `published` is ALREADY
// true and `scheduledAt` is in the future — the existing
// `POST /admin/blogs/auto-schedule` endpoint and the `PATCH
// /admin/blogs/:id/publish` endpoint both always set `published: true`
// together with `scheduledAt`, confirming this is the one true mechanism.
// (Note: humanReview.controller.js's approveOpportunityCore previously set
// `scheduledAt` on approve-and-schedule but left `published: false`, which
// meant a post approved that way would never actually go live. This was
// fixed in a later pass — approveOpportunityCore now sets `published: true`
// whenever `scheduledAt` is provided, exactly mirroring the mechanism this
// file already followed. Re-verified during the production-validation audit.)
//
// contentCalendar.service.js therefore always pairs `scheduledAt` with
// `published: true`, exactly mirroring the confirmed real mechanism, so that
// items scheduled from the Calendar/Backlog UI behave identically to any
// other existing scheduled post.

// Opportunities backing a Blogs doc that already has a resultingBlogId (i.e.
// approved) are the only ones eligible to be scheduled here.
export async function scheduleOpportunity(opportunityId, scheduledAt) {
  if (!scheduledAt) {
    const err = new Error("scheduledAt is required");
    err.statusCode = 400;
    throw err;
  }

  const opportunity = await ContentOpportunity.findById(opportunityId);
  if (!opportunity) {
    const err = new Error("Opportunity not found");
    err.statusCode = 404;
    throw err;
  }
  if (!opportunity.resultingBlogId) {
    const err = new Error("Opportunity has not been approved yet (no resulting Blogs doc)");
    err.statusCode = 409;
    throw err;
  }

  const blog = await Blogs.findById(opportunity.resultingBlogId);
  if (!blog) {
    const err = new Error("Resulting Blogs doc not found");
    err.statusCode = 404;
    throw err;
  }

  blog.scheduledAt = new Date(scheduledAt);
  blog.published = true;
  await blog.save();

  opportunity.status = "SCHEDULED";
  await opportunity.save();

  return { opportunity, blog };
}

export async function rescheduleOpportunity(opportunityId, newDate) {
  return scheduleOpportunity(opportunityId, newDate);
}

export async function unscheduleOpportunity(opportunityId) {
  const opportunity = await ContentOpportunity.findById(opportunityId);
  if (!opportunity) {
    const err = new Error("Opportunity not found");
    err.statusCode = 404;
    throw err;
  }
  if (!opportunity.resultingBlogId) {
    const err = new Error("Opportunity has no resulting Blogs doc");
    err.statusCode = 409;
    throw err;
  }

  const blog = await Blogs.findById(opportunity.resultingBlogId);
  if (!blog) {
    const err = new Error("Resulting Blogs doc not found");
    err.statusCode = 404;
    throw err;
  }

  blog.scheduledAt = null;
  blog.published = false;
  await blog.save();

  opportunity.status = "APPROVED";
  await opportunity.save();

  return { opportunity, blog };
}

// Returns scheduled/published Blogs docs within the given month
// (month = "YYYY-MM"), joined back to their source ContentOpportunity for
// course/cluster/contentType context where available (sourceOpportunityId).
export async function getCalendar({ month } = {}) {
  const monthStr = month || new Date().toISOString().slice(0, 7);
  const [year, mon] = monthStr.split("-").map(Number);
  if (!year || !mon) {
    const err = new Error("month must be in YYYY-MM format");
    err.statusCode = 400;
    throw err;
  }

  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));

  const blogs = await Blogs.find(
    {
      $or: [
        { scheduledAt: { $gte: start, $lt: end } },
        { published: true, scheduledAt: null, updatedAt: { $gte: start, $lt: end } },
      ],
    },
    { title: 1, slug: 1, published: 1, scheduledAt: 1, category: 1, sourceOpportunityId: 1, createdAt: 1, updatedAt: 1 }
  ).lean();

  const oppIds = blogs.map((b) => b.sourceOpportunityId).filter(Boolean);
  const opportunities = oppIds.length
    ? await ContentOpportunity.find(
        { _id: { $in: oppIds } },
        { courseSlug: 1, courseTitle: 1, clusterId: 1, clusterName: 1, contentType: 1, status: 1 }
      ).lean()
    : [];
  const oppById = new Map(opportunities.map((o) => [String(o._id), o]));

  const now = new Date();
  const items = blogs.map((b) => {
    const opp = b.sourceOpportunityId ? oppById.get(String(b.sourceOpportunityId)) : null;
    const isLive = b.published && (!b.scheduledAt || new Date(b.scheduledAt) <= now);
    return {
      blogId: b._id,
      title: b.title,
      slug: b.slug,
      published: b.published,
      scheduledAt: b.scheduledAt,
      status: isLive ? "PUBLISHED" : b.scheduledAt ? "SCHEDULED" : "DRAFT",
      category: b.category || opp?.courseTitle || null,
      courseSlug: opp?.courseSlug || null,
      courseTitle: opp?.courseTitle || null,
      clusterId: opp?.clusterId || null,
      clusterName: opp?.clusterName || null,
      contentType: opp?.contentType || null,
      opportunityId: b.sourceOpportunityId || null,
    };
  });

  return { month: monthStr, items };
}
