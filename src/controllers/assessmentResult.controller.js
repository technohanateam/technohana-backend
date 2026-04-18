import { AssessmentResult } from "../models/assessmentResult.model.js";

export const saveAssessmentResult = async (req, res) => {
  try {
    const {
      name, email, phone,
      courseId, courseTitle, category,
      score, totalQuestions, percentage,
      answers = [], questions = [],
    } = req.body;

    if (!name?.trim() || !email?.trim() || !phone?.trim() || !courseTitle?.trim()) {
      return res.status(400).json({ success: false, error: "name, email, phone, and courseTitle are required." });
    }

    const result = await AssessmentResult.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      courseId: courseId || "",
      courseTitle: courseTitle.trim(),
      category: category || "",
      score,
      totalQuestions,
      percentage,
      answers,
      questions,
    });

    return res.status(201).json({ success: true, id: result._id });
  } catch (err) {
    console.error("saveAssessmentResult error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to save assessment result." });
  }
};

export const getAssessmentResults = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.courseId) filter.courseId = req.query.courseId;
    if (req.query.email)    filter.email    = req.query.email.toLowerCase();

    const [results, total] = await Promise.all([
      AssessmentResult.find(filter)
        .sort({ completedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-questions -answers")
        .lean(),
      AssessmentResult.countDocuments(filter),
    ]);

    return res.json({ results, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("getAssessmentResults error:", err.message);
    return res.status(500).json({ error: "Failed to fetch assessment results." });
  }
};

export const getMyAssessmentResults = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email?.trim()) return res.status(400).json({ error: "email query param is required." });

    const results = await AssessmentResult.find({ email: email.trim().toLowerCase() })
      .sort({ completedAt: -1 })
      .select("-questions -answers")
      .lean();

    return res.json({ results });
  } catch (err) {
    console.error("getMyAssessmentResults error:", err.message);
    return res.status(500).json({ error: "Failed to fetch results." });
  }
};

export const getAssessmentResultById = async (req, res) => {
  try {
    const result = await AssessmentResult.findById(req.params.id).lean();
    if (!result) return res.status(404).json({ error: "Not found." });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch result." });
  }
};
