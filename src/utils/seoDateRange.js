// Stored SEO metric `date` fields are always UTC midnight (services parse
// dates as "YYYY-MM-DD", which `new Date()` treats as UTC midnight). A
// `from` built from `Date.now()` carries the current time-of-day, so
// `date: { $gte: from }` can fall after midnight UTC of that same calendar
// day and silently exclude it. Normalize both bounds to UTC midnight so the
// requested day range always matches what's actually stored.
function toUtcMidnight(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function dateRange(req, { defaultDays = 27 } = {}) {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - defaultDays * 86400000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  return { from: toUtcMidnight(from), to: toUtcMidnight(to) };
}

export function isValidPropertyId(propertyId) {
  return typeof propertyId === "string" && propertyId.length > 0;
}
