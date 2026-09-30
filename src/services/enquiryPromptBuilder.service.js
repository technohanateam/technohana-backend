import Course from "../models/course.model.js";
import { buildRegexQuery } from "../utils/escapeRegex.js";

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
// TODO: the enquiry-sourced flow doesn't yet fall back to
// matchCourseByDescription() using the Enquiry's own description/message
// field the way the partner flow does (admin.routes.js's /prompt-packs
// route) — a deliberately deferred follow-up, not an oversight.
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

// Fallback for when a customer states a requirement in their own words
// instead of naming a course (e.g. "identity and access management
// training, something like Okta") and matchCourse() above found nothing by
// title. Runs a plain MongoDB $text search over the catalog's description
// fields (see the text index on Course) and returns the single top-scoring
// hit, if any — a keyword match, not a semantic/AI judgement, so the caller
// must present it to the admin as a suggestion to confirm, not a certainty.
// Confidence is a coarse bucket derived from the $text relevance score.
export async function matchCourseByDescription(description) {
  if (!description || !description.trim()) return null;

  const [top] = await Course.find(
    { $text: { $search: description.trim() } },
    { score: { $meta: "textScore" } }
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(1)
    .lean();

  if (!top) return null;

  const score = top.score || 0;
  const matchConfidence = score >= 1.5 ? "high" : score >= 0.75 ? "medium" : "low";
  return { course: top, matchConfidence };
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

// Mirrors CLAUDE_COURSE_PROMPT in technohana-frontend-master's AdminCourses.jsx
// (the "Paste JSON" tab's own prompt) so a pasted response can hand off
// straight into that page's CourseModal — same JSON shape, same instructions.
export function buildCourseBriefPrompt(courseTitle) {
  const system =
    "You are Technohana's course catalog content writer. You draft new training courses as structured JSON, ready to review and publish — never inventing certifications or outcomes the course can't actually deliver.";

  const prompt = `Generate a training course as a single JSON object (no markdown, no explanation — just the JSON) with exactly these fields:

{
  "courseTitle": "string",
  "category": "string, e.g. Microsoft Azure",
  "difficulty": "Beginner | Intermediate | Advanced",
  "price": "number as string, e.g. 33600 (INR)",
  "prices": { "inr": 33600, "usd": 449, "aed": 1699, "gbp": 359, "eur": 419 },
  "instructor": "string",
  "language": "English",
  "courseDays": "e.g. 03 Days",
  "courseTime": "e.g. 24 Hours",
  "courseModules": "e.g. 12 Modules",
  "noStudents": "e.g. 30",
  "rating": "e.g. 4.3",
  "overview": "2-3 paragraph course overview",
  "courseObjective": "what this course aims to achieve",
  "courseOutcomes": "what learners will achieve",
  "labs": "hands-on lab description",
  "prerequisites": ["array of strings"],
  "whatWillYouLearn": ["array of strings"],
  "requirements": ["array of strings"],
  "targetAudience": ["array of strings"],
  "modules": [
    { "moduleTitle": "Module 01: Introduction", "content": ["Topic 1", "Topic 2"] }
  ],
  "pricingRationale": { "inr": "1 short phrase justifying this price", "usd": "...", "aed": "...", "gbp": "...", "eur": "..." },
  "contentBasis": "1 sentence on what this course content is based on (e.g. publicly known vendor certification track, general product knowledge) and whether you have limited/uncertain information on this specific topic",
  "uncertainFields": ["array of strings — name any specific claim, certification, or outcome above you're not fully confident is accurate; empty array if none"]
}

"prices" must be independently reasonable regional list prices for each currency — not a flat currency-exchange conversion of the INR figure. Base each on realistic in-market pricing for a course of this length/depth/certification level in that region (e.g. US/UK/EU courses are typically priced higher relative to PPP than a straight FX conversion would suggest).

For "pricingRationale", give one short, concrete reason per currency (e.g. comparable vendor/market rate, certification tier) — not a restatement of the number.

Be honest in "contentBasis" and "uncertainFields": if you're not confident about a certification name, exam code, or specific outcome, say so in "uncertainFields" rather than presenting it as fact. This content will be published as-is if not corrected, so do not omit uncertainty to make the output look more complete.

Course topic: ${courseTitle}`;

  return { system, prompt, generatedAt: new Date() };
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
