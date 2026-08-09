import { getRecommendationsForBlog, getRecommendationsForCourse } from "../services/internalLinkRecommendationService.js";

export const recommendForBlog = async (req, res) => {
  try {
    const result = await getRecommendationsForBlog(req.params.blogId);
    if (!result) return res.status(404).json({ success: false, message: "Blog not found" });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error computing internal-link recommendations for blog:", error);
    return res.status(500).json({ success: false, message: "Error computing internal-link recommendations" });
  }
};

export const recommendForCourse = async (req, res) => {
  try {
    const result = await getRecommendationsForCourse(req.params.courseId);
    if (!result) return res.status(404).json({ success: false, message: "Course not found" });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error computing internal-link recommendations for course:", error);
    return res.status(500).json({ success: false, message: "Error computing internal-link recommendations" });
  }
};
