// Milestone 4 stub — wires the daily planning pipeline's SHAPE so SEO gap
// analysis has a fixed call site, but the real implementation (reading synced
// SeoGscMetric for high-impression/low-CTR gaps) lands in Milestone 5. Always
// returns an empty result; makes zero AI/network calls.
export async function analyzeContentGaps() {
  return { gaps: [] };
}
