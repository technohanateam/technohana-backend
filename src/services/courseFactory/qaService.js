// Narration is required for content-bearing slide types; title/quiz/exercise/
// transition slides are commonly silent by design (the interactive component
// or a bare divider takes over) — but if the AI *did* write narration for one
// of these, that's a deliberate choice to allow, not something to strip.
const NARRATION_REQUIRED_TYPES = new Set([
  "concept", "comparison", "process", "architecture", "diagram", "code", "example", "case-study", "summary",
]);

// A lesson counts as "technical" if it teaches implementation-level content
// (code/architecture slides) — these are exactly the lessons where citing a
// real, checkable source matters most, and where an invented or unverified
// citation is most costly if wrong.
const TECHNICAL_SLIDE_TYPES = new Set(["code", "architecture"]);

// Automated QA gate (spec §23) — schema/consistency checks that run before a
// lesson can move from AI_REVIEWED to HUMAN_REVIEW. Pure function over the
// lesson doc; no AI calls, no DB writes — caller persists qualityScore/issues.
// `narrationWordsPerMinute` defaults to CourseFactorySettings' own default
// (150) so this stays a plain, DB-free function testable without mocking —
// callers that want the admin-configured value fetch it themselves and pass
// it in (same non-blocking-fetch philosophy used elsewhere in this pipeline).
export function runLessonQa(lesson, { narrationWordsPerMinute = 150 } = {}) {
  const issues = [];

  if (!lesson.title) issues.push("Missing lesson title");
  if (!Array.isArray(lesson.learningObjectives) || lesson.learningObjectives.length === 0) {
    issues.push("Missing learning objectives");
  }

  const slides = lesson.slides || [];
  if (slides.length === 0) issues.push("No slides generated");
  if (slides.length > 20) issues.push(`${slides.length} slides is likely over-generated for a single lesson`);

  // Deterministic duration check — word-count based, NOT the AI's own
  // per-slide `estimatedSeconds` guess (that field is an independent LLM
  // guess from the content-generation prompt, not derived from the actual
  // narration text, and diverged badly on a real run: 31 min actual vs an
  // 18 min target). Counts real narration text across all slides, converts
  // via a configurable speaking-rate constant.
  const targetMinutes = lesson.durationMinutes || 15;
  const totalNarrationWords = slides.reduce((sum, s) => {
    const text = (s.narration || "").trim();
    return sum + (text ? text.split(/\s+/).length : 0);
  }, 0);
  const actualMinutes = totalNarrationWords / narrationWordsPerMinute;
  const differenceMinutes = actualMinutes - targetMinutes;
  const percentageDeviation = targetMinutes > 0 ? (Math.abs(differenceMinutes) / targetMinutes) * 100 : 0;
  const withinTolerance = percentageDeviation <= 60; // same 60% threshold the old check used
  const durationReport = {
    targetMinutes,
    actualMinutes: Math.round(actualMinutes * 10) / 10,
    actualSource: "narration-word-count",
    differenceMinutes: Math.round(differenceMinutes * 10) / 10,
    percentageDeviation: Math.round(percentageDeviation),
    withinTolerance,
  };
  if (totalNarrationWords > 0 && !withinTolerance) {
    issues.push(`Narration duration (${durationReport.actualMinutes} min, word-count based) is far off the target duration (${targetMinutes} min) — ${durationReport.percentageDeviation}% deviation`);
  }

  slides.forEach((slide, i) => {
    if (!slide.narration || !slide.narration.trim()) {
      if (NARRATION_REQUIRED_TYPES.has(slide.type)) {
        issues.push(`Slide ${i + 1} (${slide.type}) has no narration`);
      }
      return;
    }
    const slideText = (slide.title || "") + " " + (slide.body || "") + " " + (slide.bullets || []).join(" ");
    if (similarity(slideText.trim().toLowerCase(), slide.narration.trim().toLowerCase()) > 0.85) {
      issues.push(`Slide ${i + 1} narration is nearly identical to the slide text — should explain, not repeat`);
    }
  });

  const quiz = lesson.quiz || [];
  if (quiz.length < 3) issues.push(`Only ${quiz.length} quiz questions — need at least 3`);
  quiz.forEach((q, i) => {
    if (q.type === "multiple-choice" && (q.correctAnswer < 0 || q.correctAnswer >= (q.options || []).length)) {
      issues.push(`Quiz question ${i + 1} has an out-of-range correctAnswer index`);
    }
    if (!q.explanation) issues.push(`Quiz question ${i + 1} is missing an explanation`);
  });

  if (!lesson.transcript || lesson.transcript.trim().length < 100) issues.push("Transcript missing or too short");

  const sources = lesson.sources || [];
  sources.forEach((src, i) => {
    if (!src.url || !/^https?:\/\//.test(src.url)) issues.push(`Source ${i + 1} has an invalid URL`);
  });

  const isTechnical = slides.some((s) => TECHNICAL_SLIDE_TYPES.has(s.type));
  if (isTechnical) {
    if (sources.length === 0) {
      issues.push("Technical lesson has no sources — not publish-ready");
    } else {
      const unverified = sources.filter((s) => s.verificationStatus !== "VERIFIED");
      if (unverified.length > 0) {
        issues.push(`${unverified.length} of ${sources.length} source(s) still PENDING_VERIFICATION — not publish-ready until a human reviewer verifies them`);
      }
    }
  }

  if (!lesson.assets?.pptxUrl) issues.push("PPTX asset not yet generated");
  // Audio is now per-slide (slides[i].audio), not a single lesson-level
  // file — a slide only needs audio if it's a narration-required type (same
  // set QA already uses above); title/quiz/transition slides are legitimately
  // silent and shouldn't block on missing audio.
  const slidesNeedingAudio = slides.filter((s) => NARRATION_REQUIRED_TYPES.has(s.type) && (s.narration || "").trim());
  const slidesMissingAudio = slidesNeedingAudio.filter((s) => s.audio?.status !== "DONE");
  if (slidesNeedingAudio.length > 0 && slidesMissingAudio.length > 0) {
    issues.push(`${slidesMissingAudio.length} of ${slidesNeedingAudio.length} slide(s) missing audio`);
  }

  // Simple 0-100 score: start at 100, subtract per issue, floor at 0.
  const qualityScore = Math.max(0, 100 - issues.length * 8);

  // publishReady is deliberately the SAME "zero issues" gate as `passed` —
  // sources issues are pushed into the shared `issues` list above like any
  // other QA failure, so an unrelated problem (too few quiz questions, a
  // missing PPTX, etc.) blocks publish-readiness exactly the same way an
  // unverified source does. There is no special carve-out where fixing
  // sources alone can make an otherwise-broken lesson "ready."
  const passed = issues.length === 0;
  return { qualityScore, issues, passed, publishReady: passed, durationReport };
}

// Cheap word-overlap ratio — good enough to flag "slide text pasted into
// narration verbatim" without pulling in a real similarity library.
function similarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.split(/\W+/).filter(Boolean));
  const setB = new Set(b.split(/\W+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const w of setA) if (setB.has(w)) overlap += 1;
  return overlap / Math.max(setA.size, setB.size);
}
