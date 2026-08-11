import { logoPath, logoSize } from "./brand/technohanaBrand.js";

// Technohana brand tokens (frontend CLAUDE.md brand palette) + shared layout
// constants. One place to tune "does this look like Technohana" without
// touching every renderer — enterprise-learning aesthetic, not "AI neon":
// generous whitespace, one accent color per element, no gradients/glows.
export const BRAND = {
  violet: "8B5CF6",
  deepViolet: "7C3AED",
  darkIndigo: "4C1D95",
  gold: "FFC107",
  white: "FFFFFF",
  ink: "1F1B2E",
  slate: "6B7280",
  slateLight: "E5E7EB",
  paper: "F8F7FC", // faint violet-tinted off-white, used for card backgrounds
};

export const LAYOUT = {
  width: 10,
  height: 5.63,
  marginX: 0.5,
  contentTop: 1.7,
  contentBottom: 5.3,
};

// Single reusable placement helper (brand integration §12) — every renderer
// that wants a Technohana mark calls this instead of hand-rolling its own
// addImage call. Width is always the caller's only size input; height is
// always derived from the source asset's real aspect ratio (technohanaBrand.js)
// so the logo can never be stretched independently in X/Y.
export function addTechnohanaLogo(slide, { variant, x, y, width }) {
  const { w, h } = logoSize(variant, width);
  slide.addImage({ path: logoPath(variant), x, y, w, h });
  return { w, h };
}

// Every non-title slide shares this chrome: title bar + footer page number +
// a small, subtle Technohana identity mark — keeps layout decisions out of
// the AI's hands (spec Priority 4: "the renderer decides HOW the slide
// looks") and out of individual renderers' hands too (brand integration
// §14: content renderers never specify a logo themselves). The mark sits at
// the far left of the footer, small enough to never compete with a
// diagram/code/table area that can run right up to ~y=5.05.
export function addSlideChrome(slide, { title, subtitle, pageNumber, kicker }) {
  slide.background = { color: BRAND.white };

  // Thin accent rule under the header — the one recurring brand signature.
  slide.addShape("rect", { x: 0, y: 0, w: LAYOUT.width, h: 0.08, fill: { color: BRAND.violet } });

  if (kicker) {
    slide.addText(kicker.toUpperCase(), {
      x: LAYOUT.marginX, y: 0.28, w: 8, h: 0.3,
      fontSize: 11, bold: true, color: BRAND.violet, fontFace: "Arial", charSpacing: 1,
    });
  }

  slide.addText(title || "", {
    x: LAYOUT.marginX, y: kicker ? 0.55 : 0.35, w: 9, h: 0.75,
    fontSize: 26, bold: true, color: BRAND.deepViolet, fontFace: "Arial",
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: LAYOUT.marginX, y: 1.25, w: 9, h: 0.4,
      fontSize: 15, italic: true, color: BRAND.slate, fontFace: "Arial",
    });
  }

  addTechnohanaLogo(slide, { variant: "icon", x: LAYOUT.marginX, y: LAYOUT.height - 0.36, width: 0.24 });

  if (pageNumber != null) {
    slide.addText(String(pageNumber), {
      x: LAYOUT.width - 0.7, y: LAYOUT.height - 0.35, w: 0.5, h: 0.28,
      fontSize: 10, color: BRAND.slate, align: "right", fontFace: "Arial",
    });
  }
}

export function contentTop(subtitle) {
  return subtitle ? 1.85 : 1.5;
}
