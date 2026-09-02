import AcademyCourse from "../../models/courseFactory/academyCourse.model.js";
import AdCreativeOpportunity from "../../models/adCreativeFactory/adCreativeOpportunity.model.js";
import Campaign from "../../models/campaign.model.js";
import SocialPost from "../../models/socialFactory/socialPost.model.js";
import { getCalendar as getBlogCalendar } from "../contentFactory/contentCalendar.service.js";

// Read-only aggregator across every factory/pipeline that has a scheduling-
// relevant date. Deliberately does NOT touch contentCalendar.service.js's
// write path (scheduleOpportunity/rescheduleOpportunity/unscheduleOpportunity)
// — those stay Blogs-specific. This just composes read queries and delegates
// the blog slice to getBlogCalendar() instead of duplicating that query.
export async function getUnifiedCalendar({ month } = {}) {
  const monthStr = month || new Date().toISOString().slice(0, 7);
  const [year, mon] = monthStr.split("-").map(Number);
  if (!year || !mon) {
    const err = new Error("month must be in YYYY-MM format");
    err.statusCode = 400;
    throw err;
  }

  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  const inRange = (field) => ({ [field]: { $gte: start, $lt: end } });

  const [blogCalendar, courses, adOpportunities, campaigns, socialPosts] = await Promise.all([
    getBlogCalendar({ month: monthStr }),
    AcademyCourse.find(
      { $or: [inRange("publishedAt"), inRange("approvedAt")] },
      { title: 1, slug: 1, status: 1, publishedAt: 1, approvedAt: 1 }
    ).lean(),
    // Known gap: AdCreativeOpportunity has no flight/start-end date fields
    // today, so reviewedAt (approval date) is used as the closest proxy.
    AdCreativeOpportunity.find(inRange("reviewedAt"), {
      courseTitle: 1,
      courseSlug: 1,
      platform: 1,
      status: 1,
      reviewedAt: 1,
    }).lean(),
    Campaign.find(
      { $or: [inRange("schedule.sendAt"), inRange("sentAt")] },
      { name: 1, status: 1, "schedule.sendAt": 1, sentAt: 1 }
    ).lean(),
    SocialPost.find(
      { $or: [inRange("scheduledAt"), inRange("publishedAt")] },
      { sourceTitle: 1, platform: 1, status: 1, scheduledAt: 1, publishedAt: 1 }
    ).lean()
  ]);

  const events = [];

  for (const item of blogCalendar.items) {
    events.push({
      sourceType: "BLOG",
      id: String(item.blogId),
      title: item.title,
      date: item.scheduledAt || item.createdAt || item.updatedAt,
      status: item.status,
      meta: { slug: item.slug, category: item.category, courseTitle: item.courseTitle },
    });
  }

  for (const course of courses) {
    events.push({
      sourceType: "COURSE",
      id: String(course._id),
      title: course.title,
      date: course.publishedAt || course.approvedAt,
      status: course.status,
      meta: { slug: course.slug },
    });
  }

  for (const opp of adOpportunities) {
    events.push({
      sourceType: "AD",
      id: String(opp._id),
      title: opp.courseTitle || "Ad creative",
      date: opp.reviewedAt,
      status: opp.status,
      meta: { platform: opp.platform, courseSlug: opp.courseSlug },
    });
  }

  for (const campaign of campaigns) {
    events.push({
      sourceType: "EMAIL",
      id: String(campaign._id),
      title: campaign.name,
      date: campaign.sentAt || campaign.schedule?.sendAt,
      status: campaign.status,
      meta: {},
    });
  }

  for (const post of socialPosts) {
    events.push({
      sourceType: "SOCIAL",
      id: String(post._id),
      title: post.sourceTitle || "Social post",
      date: post.publishedAt || post.scheduledAt,
      status: post.status,
      meta: { platform: post.platform },
    });
  }

  return { month: monthStr, events };
}
