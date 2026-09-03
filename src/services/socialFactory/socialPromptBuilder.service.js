// Builds the copy-paste prompt for the Social Media Post Factory. This is a
// pure function — it never calls Claude. The admin copies the returned
// prompt, runs it themselves in Claude.ai Pro (web), and pastes the response
// back via socialPostParser.service.js.

const PLATFORM_RULES = {
  LINKEDIN: {
    label: "LinkedIn",
    tone: "professional, insight-led, written for working professionals and hiring managers",
    length: "900-1,300 characters, short paragraphs (1-2 sentences each), no more than one emoji",
    hashtags: "3-5 hashtags, professional/industry-relevant (e.g. #CareerGrowth, #UpSkilling)",
  },
  INSTAGRAM: {
    label: "Instagram",
    tone: "energetic, visual-first, conversational, speaks directly to the learner",
    length: "125-220 characters for the caption hook plus a short supporting line, emojis welcome",
    hashtags: "8-15 hashtags mixing broad and niche terms",
  },
  X: {
    label: "X (Twitter)",
    tone: "punchy, direct, one clear idea",
    length: "under 280 characters total including hashtags",
    hashtags: "1-3 hashtags maximum",
  },
  LINKEDIN_CAROUSEL: {
    label: "LinkedIn Carousel",
    tone: "professional, insight-led, written for working professionals and hiring managers",
    length: "each slide 1-2 short sentences or a few bullet points — carousel slides are skimmed, not read like paragraphs",
    hashtags: "3-5 hashtags, professional/industry-relevant (e.g. #CareerGrowth, #UpSkilling)",
    isCarousel: true,
    slideCount: 6,
  },
  INSTAGRAM_CAROUSEL: {
    label: "Instagram Carousel",
    tone: "energetic, visual-first, conversational, speaks directly to the learner",
    length: "each slide a short punchy line or two — carousel slides are skimmed, not read like paragraphs",
    hashtags: "8-15 hashtags mixing broad and niche terms",
    isCarousel: true,
    slideCount: 6,
  },
  WHATSAPP_STATUS: {
    label: "WhatsApp Status",
    tone: "short, punchy, personal — written like a status update from a person, not an ad",
    length: "under 100 characters total, one clear idea",
    hashtags: "none — WhatsApp Status does not use hashtags",
  },
};

const RESPONSE_SHAPE = `{
  "caption": "the main post text, following the length/tone rules above",
  "hashtags": ["without", "the", "hash", "symbol"],
  "cta": "a short call to action (e.g. 'Enroll now', 'Read the full guide')",
  "imagePromptSuggestion": "a short description of a visual/image that would pair well with this post",
  "altText": "accessible alt text describing the suggested image, under 125 characters"
}`;

function carouselResponseShape(slideCount) {
  return `{
  "caption": "short cover/intro text for the carousel, following the length/tone rules above",
  "hashtags": ["without", "the", "hash", "symbol"],
  "cta": "a short call to action (e.g. 'Enroll now', 'Read the full guide')",
  "altText": "accessible alt text describing the carousel's cover slide, under 125 characters",
  "slides": [
    { "heading": "short slide heading", "body": "1-2 sentences or bullet points for this slide", "imagePromptSuggestion": "a short description of a visual for this slide" }
    // exactly ${slideCount} slide objects total, in the order they should appear
  ]
}`;
}

function buildSourceBrief(sourceType, source) {
  if (sourceType === "COURSE") {
    const lines = [
      `Course title: ${source.courseTitle}`,
      source.overview ? `Description: ${source.overview}` : null,
      Array.isArray(source.targetAudience) && source.targetAudience.length
        ? `Target audience: ${source.targetAudience.join("; ")}`
        : null,
      Array.isArray(source.whatWillYouLearn) && source.whatWillYouLearn.length
        ? `Learning objectives: ${source.whatWillYouLearn.join("; ")}`
        : null,
      source.category ? `Category: ${source.category}` : null,
    ].filter(Boolean);
    return lines.join("\n");
  }

  if (sourceType === "OPPORTUNITY") {
    const lines = [
      `Trend/topic: ${source.title}`,
      source.topicAngle ? `Technohana angle: ${source.topicAngle}` : null,
      source.recommendationReason ? `Why it matters: ${source.recommendationReason}` : null,
      source.category ? `Category: ${source.category}` : null,
      source.focusKeyword ? `Focus keyword: ${source.focusKeyword}` : null,
      source.targetAudience ? `Target audience: ${source.targetAudience}` : null,
    ].filter(Boolean);
    return lines.join("\n");
  }

  // BLOG
  const lines = [
    `Blog title: ${source.title}`,
    source.excerpt ? `Excerpt: ${source.excerpt}` : null,
    source.category ? `Category: ${source.category}` : null,
    Array.isArray(source.tags) && source.tags.length ? `Tags: ${source.tags.join(", ")}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildSocialPrompt({ sourceType, source, platform }) {
  const rules = PLATFORM_RULES[platform];
  if (!rules) {
    const err = new Error(`Unsupported platform: ${platform}`);
    err.statusCode = 400;
    throw err;
  }

  const system =
    "You are a social media copywriter for Technohana, an online professional training academy. " +
    "You write platform-native posts that drive clicks without being clickbait, and you always follow the exact response format you are given.";

  const sourceBrief = buildSourceBrief(sourceType, source);

  const sourceNoun = sourceType === "COURSE" ? "course" : sourceType === "OPPORTUNITY" ? "trending topic, discussed from Technohana's perspective" : "blog article";
  const postNoun = rules.isCarousel ? `${rules.slideCount}-slide carousel` : "post";
  const responseShape = rules.isCarousel ? carouselResponseShape(rules.slideCount) : RESPONSE_SHAPE;
  const prompt = `Write a single ${rules.label} ${postNoun} promoting the following ${sourceNoun}.

${sourceBrief}

Platform rules for ${rules.label}:
- Tone: ${rules.tone}
- Length: ${rules.length}
- Hashtags: ${rules.hashtags}
${rules.isCarousel ? `\nThe carousel must have exactly ${rules.slideCount} slides, each with its own heading, short body text, and image suggestion. Slides should build on each other in a logical order (hook -> insight -> insight -> ... -> takeaway/CTA slide).\n` : ""}
Respond with ONLY a single JSON object, no other text, no markdown code fences, in exactly this shape:
${responseShape}`;

  return { system, prompt, generatedAt: new Date() };
}

export const SOCIAL_PLATFORMS = Object.keys(PLATFORM_RULES);
export { PLATFORM_RULES };
