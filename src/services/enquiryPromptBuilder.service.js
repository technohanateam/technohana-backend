import Course from "../models/course.model.js";
import { buildRegexQuery } from "../utils/escapeRegex.js";
import { buildSocialPrompt } from "./socialFactory/socialPromptBuilder.service.js";

// Builds the copy-paste prompts for the Enquiry Prompt Pack. Pure functions —
// this file never calls Claude/OpenAI. The admin copies each prompt, runs it
// themselves in Claude.ai Pro, and pastes the response back (parsed by
// enquiryPromptParser.service.js).

// Looks the enquiry's course up in the Course catalog: by courseId first
// (matches Course.id, the catalog's public string id — not the Mongo _id),
// then by courseTitle — exact match first, falling back to a substring match
// (handles an acronym like "GICSP" typed against the full stored title
// "GICSP - Global Industrial Cybersecurity Professional"), then to matching
// just the acronym-style prefix before " - " in the stored title.
export async function matchCourse(enquiry) {
  if (enquiry.courseId) {
    const byId = await Course.findOne({ id: enquiry.courseId }).lean();
    if (byId) return byId;
  }
  if (enquiry.courseTitle) {
    const regex = buildRegexQuery(enquiry.courseTitle);
    if (regex) {
      const byExactTitle = await Course.findOne({ courseTitle: new RegExp(`^${regex.source}$`, "i") }).lean();
      if (byExactTitle) return byExactTitle;

      const bySubstring = await Course.findOne({ courseTitle: regex }).lean();
      if (bySubstring) return bySubstring;

      const trimmedTitle = enquiry.courseTitle.trim().toLowerCase();
      const candidates = await Course.find({}, { courseTitle: 1 }).lean();
      const byAcronymPrefix = candidates.find(
        (c) => c.courseTitle?.split(" - ")[0]?.trim().toLowerCase() === trimmedTitle
      );
      if (byAcronymPrefix) return byAcronymPrefix;
    }
  }
  return null;
}

export function buildTrainerSearchPrompt(enquiry, course) {
  const courseTitle = course?.courseTitle || enquiry.courseTitle || "the requested course";
  const system =
    "You are Technohana's talent acquisition copywriter. You write LinkedIn posts that attract qualified freelance trainers/consultants, in a professional and specific tone — never generic or spammy.";

  const briefLines = [
    `Course: ${courseTitle}`,
    course?.category ? `Category: ${course.category}` : null,
    course?.overview ? `Course overview: ${course.overview}` : null,
    Array.isArray(course?.whatWillYouLearn) && course.whatWillYouLearn.length
      ? `Topics covered: ${course.whatWillYouLearn.join("; ")}`
      : null,
    enquiry.trainingLocation ? `Delivery location/timezone: ${enquiry.trainingLocation}` : null,
    enquiry.trainingType ? `Format: ${enquiry.trainingType}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `Write a single LinkedIn post recruiting a freelance trainer/consultant for the following course, on behalf of Technohana, an online professional training academy.

${briefLines}

The post should:
- Open with a specific hook naming the exact skill/technology, not "We're hiring"
- List what we're looking for: relevant expertise, real-world delivery experience, ability to teach both beginners and working professionals
- Ask interested trainers to comment or DM with their LinkedIn profile / portfolio
- Be 800-1200 characters, professional tone, 3-5 relevant hashtags (e.g. #Trainer, #FreelanceTrainer, #${(course?.category || "TechTraining").replace(/\s+/g, "")})

Respond with ONLY a single JSON object, no other text, no markdown code fences, in exactly this shape:
{
  "postText": "the full LinkedIn post text, including hashtags"
}`;

  return { system, prompt, generatedAt: new Date() };
}

export function buildSocialPostPrompt(course) {
  return buildSocialPrompt({ sourceType: "COURSE", source: course, platform: "LINKEDIN" });
}

export function buildBlogPostPrompt(course) {
  const system =
    "You are Technohana's Senior Content Writer. You write SEO-friendly, factually grounded blog articles for a professional training academy audience, using only the source material provided — never inventing facts, statistics, or claims not present in it.";

  const sourceLines = [
    `Course title: ${course.courseTitle}`,
    course.overview ? `Overview: ${course.overview}` : null,
    course.courseObjective ? `Objective: ${course.courseObjective}` : null,
    course.courseOutcomes ? `Outcomes: ${course.courseOutcomes}` : null,
    Array.isArray(course.whatWillYouLearn) && course.whatWillYouLearn.length
      ? `What learners will learn: ${course.whatWillYouLearn.join("; ")}`
      : null,
    Array.isArray(course.modules) && course.modules.length
      ? `Modules: ${course.modules.map((m) => m.moduleTitle).filter(Boolean).join("; ")}`
      : null,
    course.category ? `Category: ${course.category}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `Write a blog article for Technohana's blog, based only on the following course content — do not invent facts, statistics, or claims not supported by this material.

${sourceLines}

Requirements:
- Minimum 700 words, valid HTML content (paragraphs, headings, lists as needed)
- Naturally place a focus keyword in: title, first paragraph, one H2, conclusion
- Include exactly two internal links: <a href="/courses/">Technohana courses</a> and <a href="/blog/">related blog posts</a>
- Tone: informative, written for working professionals considering this course

Respond with ONLY a single JSON object, no other text, no markdown code fences, in exactly this shape:
{
  "title": "",
  "content": "",
  "excerpt": "40-70 words",
  "metaTitle": "50-60 characters",
  "metaDescription": "140-160 characters",
  "focusKeyword": "one primary keyword",
  "tags": ["array", "of", "strings"]
}`;

  return { system, prompt, generatedAt: new Date() };
}
