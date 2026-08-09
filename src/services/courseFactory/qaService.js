// Automated QA gate (spec §23) — schema/consistency checks that run before a
// lesson can move from AI_REVIEWED to HUMAN_REVIEW. Pure function over the
// lesson doc; no AI calls, no DB writes — caller persists qualityScore/issues.
export function runLessonQa(lesson) {
  const issues = [];

  if (!lesson.title) issues.push("Missing lesson title");
  if (!Array.isArray(lesson.learningObjectives) || lesson.learningObjectives.length === 0) {
    issues.push("Missing learning objectives");
  }

  const slides = lesson.slides || [];
  if (slides.length === 0) issues.push("No slides generated");
  if (slides.length > 20) issues.push(`${slides.length} slides is likely over-generated for a single lesson`);

  const expectedSeconds = (lesson.durationMinutes || 15) * 60;
  const slideSeconds = slides.reduce((sum, s) => sum + (s.estimatedSeconds || 0), 0);
  if (slideSeconds > 0 && Math.abs(slideSeconds - expectedSeconds) / expectedSeconds > 0.6) {
    issues.push(`Slide timing (${Math.round(slideSeconds / 60)} min) is far off the target duration (${lesson.durationMinutes} min)`);
  }

  slides.forEach((slide, i) => {
    if (!slide.narration || !slide.narration.trim()) {
      issues.push(`Slide ${i + 1} has no narration`);
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

  (lesson.sources || []).forEach((src, i) => {
    if (!src.url || !/^https?:\/\//.test(src.url)) issues.push(`Source ${i + 1} has an invalid URL`);
  });

  if (!lesson.assets?.pptxUrl) issues.push("PPTX asset not yet generated");
  if (!lesson.narration?.audioUrl) issues.push("Audio asset not yet generated");

  // Simple 0-100 score: start at 100, subtract per issue, floor at 0.
  const qualityScore = Math.max(0, 100 - issues.length * 8);

  return { qualityScore, issues, passed: issues.length === 0 };
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
