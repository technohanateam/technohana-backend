// Milestone 4 stub — wires the daily planning pipeline's SHAPE so trend
// research has a fixed call site, but the real implementation (batched
// per-cluster web_search_20260209 calls) lands in Milestone 5. Always
// returns an empty result; makes zero AI calls, so it never touches the
// research-call budget on its own.
export async function researchTrends() {
  return { trends: [] };
}
