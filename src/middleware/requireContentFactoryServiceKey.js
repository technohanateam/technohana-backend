// Narrow API-key guard for the one route an unattended external agent calls
// (the weekly trend-research cloud routine) — it has no admin login, so it
// can't use authenticateAdmin. Scoped to this single route only.
export const requireContentFactoryServiceKey = (req, res, next) => {
  const key = req.headers["x-service-key"];
  const expected = process.env.CONTENT_FACTORY_SERVICE_KEY;

  if (!expected) {
    return res.status(503).json({ success: false, message: "CONTENT_FACTORY_SERVICE_KEY is not configured." });
  }
  if (!key || key !== expected) {
    return res.status(401).json({ success: false, message: "Invalid or missing service key." });
  }
  next();
};
