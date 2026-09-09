import { parseModelJson } from "../../utils/parseModelJson.js";
import { isSsrfBlocked, fetchAndBuildCoursePrompt } from "../../services/contentFactory/urlImport.service.js";

// POST /admin/courses/import-from-urls — scans vendor course pages and
// builds a Claude Pro prompt to generate a new Technohana course grounded in
// that material. Manual Claude Pro workflow (mirrors generateFromUrls /
// generateFromCourse — ANTHROPIC_API_KEY has no working billing): first call
// (no pastedResponse) fetches the URLs and returns the prompt for the admin
// to run in Claude Pro chat themselves; second call (pastedResponse set)
// parses what they paste back and returns the course JSON directly, for the
// admin to review/edit in the New Course form (no ContentOpportunity/Human
// Review save — courses are created directly, same as the existing
// Paste JSON flow).
export const generateCourseFromUrls = async (req, res) => {
  const { urls, courseTitle, pastedResponse } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, message: "Provide at least one URL." });
  }
  if (urls.length > 5) {
    return res.status(400).json({ success: false, message: "Maximum 5 URLs allowed." });
  }
  if (urls.some(isSsrfBlocked)) {
    return res.status(400).json({ success: false, message: "One or more URLs are not allowed." });
  }

  if (!pastedResponse) {
    const { failedUrls, systemPrompt, userPrompt } = await fetchAndBuildCoursePrompt({ urls, courseTitle });
    return res.json({
      success: true,
      awaitingInput: true,
      prompts: [{ label: "Course JSON", system: systemPrompt, prompt: userPrompt }],
      ...(failedUrls.length ? { warnings: failedUrls } : {}),
    });
  }

  let generated;
  try {
    generated = parseModelJson(pastedResponse);
  } catch {
    generated = null;
  }
  if (!generated || !generated.courseTitle) {
    console.error("courses/import-from-urls: failed to parse pasted response. Raw:", String(pastedResponse).slice(0, 500));
    return res.status(500).json({ success: false, message: "Failed to parse the pasted response. Make sure it's the full JSON reply with a courseTitle field." });
  }
  if (courseTitle) generated.courseTitle = courseTitle;

  return res.json({ success: true, data: generated });
};
