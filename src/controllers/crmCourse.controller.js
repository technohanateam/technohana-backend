import Course from "../models/course.model.js";
import { sendCrmError } from "../utils/crmQuery.js";

// GET /courses — catalog for reps, with just the fields needed to browse and recommend.
export const getCourses = async (_req, res) => {
  try {
    const data = await Course.find({ id: { $not: /^playbook-/i } })
      .select("id courseTitle courseSlug category difficulty price prices courseDays courseTime -_id")
      .sort({ category: 1, courseTitle: 1 })
      .lean();
    res.json({ success: true, data });
  } catch (err) {
    sendCrmError(res, err, "Failed to load courses");
  }
};
