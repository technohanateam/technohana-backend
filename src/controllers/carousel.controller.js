import axios from "axios";
import Carousel from "../models/carousel.model.js";

// GET /admin/carousels
export const getAllCarousels = async (req, res) => {
  try {
    const { status, isTemplate, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status) filter.status = status;
    if (isTemplate !== undefined) filter.isTemplate = isTemplate === "true";

    const [data, total] = await Promise.all([
      Carousel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Carousel.countDocuments(filter),
    ]);

    return res.json({ data, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("Get carousels error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /admin/carousels/:id
export const getCarousel = async (req, res) => {
  try {
    const carousel = await Carousel.findById(req.params.id).lean();
    if (!carousel) return res.status(404).json({ message: "Carousel not found." });
    return res.json({ data: carousel });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /admin/carousels
export const createCarousel = async (req, res) => {
  try {
    const { title, topic, theme, slides, status, isTemplate } = req.body;
    if (!title) return res.status(400).json({ message: "title is required." });

    const carousel = await Carousel.create({ title, topic, theme, slides, status, isTemplate });
    return res.status(201).json({ data: carousel });
  } catch (err) {
    console.error("Create carousel error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /admin/carousels/:id
export const updateCarousel = async (req, res) => {
  try {
    const carousel = await Carousel.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    ).lean();
    if (!carousel) return res.status(404).json({ message: "Carousel not found." });
    return res.json({ data: carousel });
  } catch (err) {
    console.error("Update carousel error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// DELETE /admin/carousels/:id
export const deleteCarousel = async (req, res) => {
  try {
    const carousel = await Carousel.findByIdAndDelete(req.params.id);
    if (!carousel) return res.status(404).json({ message: "Carousel not found." });
    return res.json({ message: "Deleted." });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /admin/carousels/generate
export const generateCarousel = async (req, res) => {
  try {
    const { topic, slideCount = 6, audience, tone, courseTitle } = req.body;
    if (!topic) return res.status(400).json({ message: "topic is required." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ message: "AI generation not configured. Add ANTHROPIC_API_KEY to .env" });
    }

    const count = Math.min(Math.max(parseInt(slideCount) || 6, 3), 15);
    const subjectLine = courseTitle ? `Course: ${courseTitle}\nTopic: ${topic}` : `Topic: ${topic}`;

    const prompt = `You are a LinkedIn content strategist for Technohana, a tech training platform.

${subjectLine}
Target audience: ${audience || "tech professionals and L&D managers"}
Tone: ${tone || "professional and insightful"}
Number of slides: ${count}

Create a LinkedIn carousel with exactly ${count} slides.

Rules:
- Slide 1: Bold hook — a strong statement or provocative question that stops the scroll
- Slides 2 to ${count - 1}: One key insight per slide — short and punchy, no filler
- Slide ${count}: CTA — mention Technohana training, invite them to visit technohana.in
- headline: max 60 characters
- body: max 180 characters, 2-3 short sentences max
- No emojis. Plain professional English.

Return ONLY a valid JSON array, no markdown fences, no explanation:
[{"order":1,"headline":"...","body":"..."},...]`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-opus-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      }
    );

    const raw = response.data?.content?.[0]?.text || "";
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let slides;
    try {
      slides = JSON.parse(cleaned);
    } catch {
      console.error("Carousel JSON parse failed. Raw:", raw);
      return res.status(500).json({ message: "AI returned invalid JSON. Try again.", raw });
    }

    return res.json({ slides });
  } catch (err) {
    console.error("Generate carousel error:", err?.response?.data || err.message);
    return res.status(500).json({ message: "Generation failed. Try again." });
  }
};
