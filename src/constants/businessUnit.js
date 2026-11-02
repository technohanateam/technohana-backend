export const BUSINESS_UNITS = ["b2c", "b2b", "ai"];

const PIPELINE_TYPE_TO_UNIT = {
  individual: "b2c",
  certification: "b2c",
  corporate: "b2b",
  consulting: "ai",
  ai_projects: "ai",
};

// Returns null when the unit can't be determined, so reports show "Unassigned" instead of guessing.
export const businessUnitForPipelineType = (type) => PIPELINE_TYPE_TO_UNIT[type] || null;

// Orders are learner checkouts (enrollmentType is only "individual" or "group", no corporate
// marker), so they count as b2c. Corporate revenue is tracked through deals and, later, invoices.
export const businessUnitForOrder = (order) => (order ? "b2c" : null);
