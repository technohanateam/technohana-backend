import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainerSearchPrompt,
  buildSocialPostPrompt,
  buildBlogPostPrompt,
} from "../../src/services/enquiryPromptBuilder.service.js";
import {
  parseTrainerSearchResponse,
  parseSocialPostResponse,
  parseBlogPostResponse,
} from "../../src/services/enquiryPromptParser.service.js";

const SAMPLE_COURSE = {
  courseTitle: "Certified Kubernetes Administrator",
  category: "DevOps",
  overview: "A hands-on course covering Kubernetes cluster administration.",
  courseObjective: "Prepare learners to operate production Kubernetes clusters.",
  courseOutcomes: "Learners will be able to deploy and manage Kubernetes workloads.",
  whatWillYouLearn: ["Cluster setup", "Networking", "Security"],
  modules: [{ moduleTitle: "Module 01: Introduction", content: ["Topic 1"] }],
};

test("builder never imports the Anthropic/OpenAI SDK (stays zero-API-cost)", async () => {
  const builderSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../src/services/enquiryPromptBuilder.service.js", import.meta.url), "utf-8")
  );
  assert.ok(!builderSrc.includes("@anthropic-ai/sdk"));
  assert.ok(!builderSrc.includes("aiAgent.service"));
  assert.ok(!builderSrc.includes("openai"));
});

test("buildTrainerSearchPrompt works with only an enquiry (no matched course)", () => {
  const { system, prompt, generatedAt } = buildTrainerSearchPrompt({ courseTitle: "Advanced React" }, null);
  assert.ok(system.length > 0);
  assert.match(prompt, /Advanced React/);
  assert.match(prompt, /"postText"/);
  assert.ok(generatedAt instanceof Date);
});

test("buildTrainerSearchPrompt includes course overview/topics when a course is matched", () => {
  const { prompt } = buildTrainerSearchPrompt({ courseTitle: SAMPLE_COURSE.courseTitle }, SAMPLE_COURSE);
  assert.match(prompt, /Cluster administration|Kubernetes cluster administration/);
  assert.match(prompt, /Cluster setup/);
});

test("buildSocialPostPrompt reuses the Social Factory LINKEDIN prompt shape", () => {
  const { prompt } = buildSocialPostPrompt(SAMPLE_COURSE);
  assert.match(prompt, /LinkedIn/);
  assert.match(prompt, /"caption"/);
  assert.match(prompt, /"hashtags"/);
});

test("buildBlogPostPrompt grounds the prompt in the course's own content only", () => {
  const { prompt } = buildBlogPostPrompt(SAMPLE_COURSE);
  assert.match(prompt, /Certified Kubernetes Administrator/);
  assert.match(prompt, /do not invent facts/i);
  assert.match(prompt, /"title"/);
  assert.match(prompt, /"focusKeyword"/);
});

// Round-trip: a hand-written "pasted Claude response" for each prompt's exact
// declared JSON shape must parse cleanly — this is the real regression risk
// (builder prompt drifting out of sync with the parser's expected fields).
test("trainerSearch prompt <-> parser round trip", () => {
  const pasted = JSON.stringify({ postText: "We're hiring a Kubernetes trainer! #Trainer #FreelanceTrainer" });
  const parsed = parseTrainerSearchResponse(pasted);
  assert.equal(parsed.postText, "We're hiring a Kubernetes trainer! #Trainer #FreelanceTrainer");
});

test("socialPost prompt <-> parser round trip", () => {
  const pasted = JSON.stringify({
    caption: "Learn Kubernetes with Technohana.",
    hashtags: ["#Kubernetes", "DevOps"],
    cta: "Enroll now",
    imagePromptSuggestion: "A cluster diagram",
    altText: "Kubernetes cluster diagram",
  });
  const parsed = parseSocialPostResponse(pasted);
  assert.equal(parsed.caption, "Learn Kubernetes with Technohana.");
  assert.deepEqual(parsed.hashtags, ["Kubernetes", "DevOps"]);
});

test("blogPost prompt <-> parser round trip", () => {
  const pasted = JSON.stringify({
    title: "Mastering Kubernetes Administration",
    content: "<p>Kubernetes is...</p>",
    excerpt: "A short excerpt about Kubernetes.",
    metaTitle: "Kubernetes Admin Course | Technohana",
    metaDescription: "Learn Kubernetes cluster administration with Technohana's hands-on course.",
    focusKeyword: "Kubernetes administration",
    tags: ["Kubernetes", "DevOps"],
  });
  const parsed = parseBlogPostResponse(pasted);
  assert.equal(parsed.title, "Mastering Kubernetes Administration");
  assert.deepEqual(parsed.tags, ["Kubernetes", "DevOps"]);
});

test("parsers reject a response missing a required field", () => {
  assert.throws(() => parseTrainerSearchResponse(JSON.stringify({})), /postText/);
  assert.throws(() => parseSocialPostResponse(JSON.stringify({ caption: "x" })), /cta/);
  assert.throws(() => parseBlogPostResponse(JSON.stringify({ title: "x" })), /content/);
});

test("parsers reject text with no JSON object at all", () => {
  assert.throws(() => parseTrainerSearchResponse("not json"), /Could not parse/);
});
