// Blocks MongoDB operator injection on /api/crm. Express 4 parses query strings
// with `qs`, so `?status[$ne]=x` arrives as an object and would flow straight
// into a find() filter; JSON bodies can carry `{"$gt": ""}` the same way.
// CRM query params are always plain strings, and no CRM body key starts with `$`.

const hasOperatorKey = (value, depth = 0) => {
  if (depth > 20 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => hasOperatorKey(v, depth + 1));
  return Object.keys(value).some((k) => k.startsWith("$") || hasOperatorKey(value[k], depth + 1));
};

export const crmInputGuard = (req, res, next) => {
  const badQuery = Object.entries(req.query || {}).find(([, v]) => typeof v !== "string");
  if (badQuery) {
    return res.status(400).json({ success: false, message: `Invalid query parameter: ${badQuery[0]}` });
  }
  if (hasOperatorKey(req.body)) {
    return res.status(400).json({ success: false, message: "Invalid request body" });
  }
  next();
};
