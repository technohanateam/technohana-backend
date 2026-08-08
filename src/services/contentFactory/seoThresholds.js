// Ported from AdminBlogs.jsx's SEO tab (CharCounter usage / SEO checklist),
// which encodes these exact target ranges — kept as a single shared source
// so seoFieldWriter.service.js never drifts from what the editor UI checks.
export const META_TITLE_RANGE = { min: 50, max: 60 };
export const META_DESCRIPTION_RANGE = { min: 140, max: 160 };
