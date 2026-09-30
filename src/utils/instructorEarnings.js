import Course from "../models/course.model.js";
import { Order } from "../models/order.model.js";

// Shared by GET /instructor/earnings and the payout-request endpoint so both
// use the same discount/participants math against the same set of paid orders.
export const computeInstructorEarnings = async (instructorId) => {
  const courses = await Course.find({ instructorId }).lean();
  if (!courses.length) return { totalMinor: 0, byMonth: [], byCourse: [] };

  const courseIds = courses.map((c) => c.id || String(c._id));

  const orders = await Order.find({ courseId: { $in: courseIds }, status: "paid" }).lean();

  const byCourse = courses.map((course) => {
    const cid = course.id || String(course._id);
    const courseOrders = orders.filter((o) => o.courseId === cid);
    const gross = courseOrders.reduce((sum, o) => sum + (o.basePriceMinor || 0) * (o.participants || 1), 0);
    const revenue = courseOrders.reduce((sum, o) => {
      const base = (o.basePriceMinor || 0) * (o.participants || 1);
      const discount = (o.totalDiscountPercent || 0) / 100;
      return sum + base * (1 - discount);
    }, 0);
    return {
      courseId: cid,
      courseTitle: course.courseTitle,
      enrollments: courseOrders.length,
      grossMinor: gross,
      revenueMinor: revenue,
      revenueMajor: (revenue / 100).toFixed(2),
    };
  });

  const monthMap = {};
  orders.forEach((o) => {
    const d = new Date(o.paidAt || o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthMap[key]) monthMap[key] = 0;
    const base = (o.basePriceMinor || 0) * (o.participants || 1);
    const discount = (o.totalDiscountPercent || 0) / 100;
    monthMap[key] += base * (1 - discount);
  });
  const byMonth = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenueMinor]) => ({ month, revenueMinor, revenueMajor: (revenueMinor / 100).toFixed(2) }));

  const totalMinor = byCourse.reduce((s, c) => s + c.revenueMinor, 0);

  return { totalMinor, byMonth, byCourse };
};
