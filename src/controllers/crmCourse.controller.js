import axios from "axios";
import crypto from "crypto";
import Course from "../models/course.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { leadScope, sendCrmError } from "../utils/crmQuery.js";
import { generateCoursePdf, coursePdfFilename } from "../utils/generateCoursePdf.js";
import { deliverCrmEmail } from "./crmActivity.controller.js";
import { getActiveConnection } from "../services/zohoService.js";

const SITE = "https://www.technohana.in";

// Statuses before a course has been recommended; recommending / running the
// skills-gap analysis moves a lead forward from these, never backwards.
export const BEFORE_SKILL_GAP = ["new", "contacted", "discovery", "needs_analysis"];
const BEFORE_RECOMMENDED = [...BEFORE_SKILL_GAP, "skill_gap_assessed"];

// Price may only appear in a recommendation email from the proposal stage on.
const PRICE_STAGES = ["proposal_sent", "negotiation", "quotation_sent", "purchase_order", "payment_pending", "won", "enrolled"];

const CURRENCY_PREFIX = { inr: "INR ", usd: "USD ", aed: "AED ", gbp: "GBP ", eur: "EUR " };
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const logStatusChange = (leadId, from, to, performedBy, why) =>
  CRMActivity.create({
    type: "status_change", title: "Status changed", body: `Status changed from ${from} to ${to} (${why})`,
    relatedToType: "lead", relatedToId: leadId, performedBy, metadata: { from, to },
  }).catch((e) => console.error("Activity log failed:", e.message));

// GET /courses/:id/pdf — brochure without pricing.
export const getCoursePdf = async (req, res) => {
  try {
    const id = str(req.params.id, 50);
    const course = id && await Course.findOne({ id }).lean();
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const pdf = await generateCoursePdf(course, { siteUrl: SITE });
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${coursePdfFilename(course)}"`,
      "Content-Length": pdf.length,
    });
    res.send(pdf);
  } catch (err) {
    sendCrmError(res, err, "Failed to generate the course PDF");
  }
};

// POST /leads/:id/skills-gap — runs the same Hana agent as technohana.in/skills-gap,
// server-side, without sending the lead's name/email (that would create a duplicate site lead).
export const runSkillsGap = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope).select("status").lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const currentRole = str(req.body.currentRole, 100);
    const targetRole = str(req.body.targetRole, 100);
    if (!currentRole || !targetRole) {
      return res.status(400).json({ success: false, message: "Enter both the current and the target role" });
    }
    if (currentRole.toLowerCase() === targetRole.toLowerCase()) {
      return res.status(400).json({ success: false, message: "Current and target role must be different" });
    }
    const currency = ["inr", "usd", "aed"].includes(req.body.currency) ? req.body.currency : "inr";

    const base = process.env.CHAT_API_URL;
    if (!base) return res.status(503).json({ success: false, message: "Skills-gap service isn't configured (CHAT_API_URL)." });

    let analysis;
    try {
      const { data } = await axios.post(`${base.replace(/\/$/, "")}/api/skills-gap`,
        { current_role: currentRole, target_role: targetRole, currency }, { timeout: 90000 });
      analysis = data;
    } catch (err) {
      console.error("CRM skills-gap call failed:", err.response?.status || err.message);
      const msg = err.response?.status === 429
        ? "The skills-gap tool is busy. Try again in a few minutes."
        : "The skills-gap analysis couldn't be completed. Try again shortly.";
      return res.status(502).json({ success: false, message: msg });
    }

    const update = { skillGapData: { currentRole, targetRole, currency, analysis, analyzedAt: new Date(), analyzedBy: req.admin._id } };
    const advance = BEFORE_SKILL_GAP.includes(lead.status);
    if (advance) update.status = "skill_gap_assessed";
    await CRMLead.updateOne({ _id: lead._id }, { $set: update });
    if (advance) await logStatusChange(lead._id, lead.status, "skill_gap_assessed", req.admin._id, "skills-gap analysis");

    res.json({ success: true, data: { analysis, status: advance ? "skill_gap_assessed" : lead.status }, message: "Skills-gap analysis saved to the lead" });
  } catch (err) {
    sendCrmError(res, err, "Skills-gap analysis failed");
  }
};

// POST /leads/:id/skills-gap-link — gives the lead a personal Skills Gap link. With
// `send: true` it is emailed to the lead; otherwise it is only returned so the rep can
// paste it into WhatsApp. A submission through the link is attached back to the lead.
export const sendSkillsGapLink = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope).select("name email tags publicToken").populate("tags", "name").lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    let token = lead.publicToken;
    if (!token) {
      token = crypto.randomBytes(18).toString("base64url");
      // Conditional set: two reps clicking at once can't replace each other's token.
      const set = await CRMLead.updateOne({ _id: lead._id, publicToken: null }, { $set: { publicToken: token } });
      if (!set.modifiedCount) token = (await CRMLead.findById(lead._id).select("publicToken").lean())?.publicToken || token;
    }
    const link = `${SITE}/skills-gap?cl=${token}`;

    if (req.body.send !== true) {
      return res.json({ success: true, data: { link, emailed: false }, message: "Skills Gap link ready" });
    }

    const body = [
      `Hi ${firstName(lead.name)},`,
      "To suggest the right learning path for you, could you take a couple of minutes to try our free Skills Gap tool? Tell us your current role and the role you're aiming for, and you'll get a personalised plan by email.",
      link,
      "Happy to go through the results with you on a quick call.",
      "Best regards,",
    ].join("\n\n");

    const out = await deliverCrmEmail(req, { record: lead, relatedToType: "lead", subject: "Your free Skills Gap analysis", body });
    if (out.status >= 400) return res.status(out.status).json(out.json);
    res.json({ success: true, data: { link, emailed: true }, message: out.json.message });
  } catch (err) {
    sendCrmError(res, err, "Failed to prepare the Skills Gap link");
  }
};

const loadLeadAndCourse = async (req) => {
  const scope = leadScope(req, req.params.id);
  const courseId = str(req.body.courseId, 50);
  const [lead, course] = await Promise.all([
    scope && CRMLead.findOne(scope).select("name email status currency tags recommendedCourses").populate("tags", "name").lean(),
    courseId && Course.findOne({ id: courseId }).lean(),
  ]);
  return { lead, course };
};

const requireCourseId = (req, res) => {
  if (str(req.body.courseId, 50)) return true;
  res.status(400).json({ success: false, message: "courseId is required" });
  return false;
};

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";

const buildDraft = ({ lead, course, reason }) => {
  const includePrice = PRICE_STAGES.includes(lead.status);
  const cur = ["inr", "usd", "aed", "gbp", "eur"].includes(String(lead.currency).toLowerCase()) ? String(lead.currency).toLowerCase() : "inr";
  const amount = course.prices?.[cur] ?? course.prices?.inr;
  const overview = String(course.overview || "").replace(/\s+/g, " ").trim();
  const short = overview.length > 320 ? `${overview.slice(0, 317).replace(/\s+\S*$/, "")}...` : overview;

  const details = [
    course.difficulty && `Level: ${course.difficulty}`,
    [course.courseDays, course.courseTime].filter(Boolean).length && `Duration: ${[course.courseDays, course.courseTime].filter(Boolean).join(" / ")}`,
    includePrice && amount != null && `Price: ${CURRENCY_PREFIX[course.prices?.[cur] != null ? cur : "inr"]}${Number(amount).toLocaleString("en-IN")}`,
  ].filter(Boolean);

  const slug = course.courseSlug || course.id;
  const body = [
    `Hi ${firstName(lead.name)},`,
    `Based on our conversation, I'd recommend our ${course.courseTitle} for you.${reason ? ` ${reason}` : ""}`,
    short,
    details.length ? details.join("\n") : null,
    `You can see the full details here: ${SITE}/courses/${slug}`,
    "Happy to answer any questions or set up a quick call.",
    "Best regards,",
  ].filter(Boolean).join("\n\n");

  return { subject: `Recommended course: ${course.courseTitle}`, body, priceIncluded: includePrice && amount != null };
};

// POST /leads/:id/recommend-course/draft — returns the email for the rep to review. Sends nothing.
export const draftRecommendationEmail = async (req, res) => {
  try {
    if (!requireCourseId(req, res)) return;
    const { lead, course } = await loadLeadAndCourse(req);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const draft = buildDraft({ lead, course, reason: str(req.body.reason, 300) });
    const zoho = await getActiveConnection(req.admin._id);
    res.json({
      success: true,
      data: {
        ...draft, to: lead.email || null, leadName: lead.name, leadStatus: lead.status,
        attachmentName: coursePdfFilename(course),
        from: zoho?.zohoMailAccountId ? zoho.emailAddress : null,
      },
      message: "Email draft ready for review",
    });
  } catch (err) {
    sendCrmError(res, err, "Failed to prepare the email draft");
  }
};

// POST /leads/:id/recommend-course — saves the recommendation and, when the rep has
// reviewed the draft and asked for it, emails exactly the subject/body they approved.
export const recommendCourse = async (req, res) => {
  try {
    if (!requireCourseId(req, res)) return;
    const { lead, course } = await loadLeadAndCourse(req);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const wantsEmail = req.body.sendEmail === true;
    const subject = str(req.body.subject, 200);
    const body = str(req.body.body, 20000);
    if (wantsEmail && (!subject || !body)) {
      return res.status(400).json({ success: false, message: "Add a subject and a message before sending" });
    }

    // Built before anything is saved, so a PDF failure sends nothing and changes nothing.
    let attachments = [];
    if (wantsEmail && req.body.attachPdf === true) {
      try {
        attachments = [{ filename: coursePdfFilename(course), content: await generateCoursePdf(course, { siteUrl: SITE }) }];
      } catch (err) {
        console.error("Course PDF generation failed:", err.message);
        return res.status(500).json({ success: false, message: "Couldn't create the syllabus PDF. Try again, or send without it." });
      }
    }

    const entry = { courseId: course.id, courseTitle: course.courseTitle, reason: str(req.body.reason, 300) || undefined };
    // Conditional push: two reps recommending at once can't overwrite each other or double-add.
    const saved = await CRMLead.updateOne(
      { _id: lead._id, "recommendedCourses.courseId": { $ne: course.id } },
      { $push: { recommendedCourses: entry } },
    );
    const added = saved.modifiedCount > 0;

    let status = lead.status;
    if (BEFORE_RECOMMENDED.includes(lead.status)) {
      await CRMLead.updateOne({ _id: lead._id }, { $set: { status: "course_recommended" } });
      await logStatusChange(lead._id, lead.status, "course_recommended", req.admin._id, `recommended ${course.courseTitle}`);
      status = "course_recommended";
    }

    if (!wantsEmail) {
      return res.json({ success: true, data: { added, status, emailed: false }, message: added ? `Recommended to ${lead.name}` : `Already recommended to ${lead.name}` });
    }

    const out = await deliverCrmEmail(req, { record: lead, relatedToType: "lead", subject, body, requireZoho: true, attachments });
    if (out.status >= 400) {
      return res.status(out.status).json({
        success: false,
        message: `${added ? "Recommendation saved, but" : "Already recommended, and"} the email wasn't sent: ${out.json.message}`,
      });
    }
    res.status(201).json({ success: true, data: { added, status, emailed: true }, message: `Recommended to ${lead.name} and email sent to ${lead.email}` });
  } catch (err) {
    sendCrmError(res, err, "Failed to recommend the course");
  }
};
