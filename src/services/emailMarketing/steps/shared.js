// Shared helpers for the campaign copy step pipeline (SUBJECT/PREVIEW/BODY/CTA/VARIANTS).
// Guardrail carried over from the original single-shot campaignCopywriterAgent.js —
// AI copy must never emit a price, coupon code, or raw URL.
export function stripUnsafe(s = "") {
  return String(s)
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b(₹|INR|USD|\$|AED|£|€)\s*[\d,]+/gi, "[price]")
    .replace(/\b[A-Z]{4,}\d{1,2}\b/g, "[code]");
}

export function extractFirstJsonObject(raw) {
  const match = String(raw).match(/\{[\s\S]*\}/);
  return JSON.parse(match?.[0] || raw);
}
