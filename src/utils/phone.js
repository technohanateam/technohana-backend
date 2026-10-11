// Mirrors toE164 in technohana-crm/src/utils/crmFormatters.js (frontend wa.me links).
const DIAL_CODES = {
  india: "91", in: "91",
  uae: "971", "united arab emirates": "971", ae: "971",
  "saudi arabia": "966", ksa: "966", sa: "966",
  qatar: "974", qa: "974", oman: "968", om: "968", bahrain: "973", bh: "973", kuwait: "965", kw: "965",
  "united states": "1", usa: "1", us: "1", canada: "1", ca: "1",
  "united kingdom": "44", uk: "44", gb: "44",
};

// "+<digits>" for dedupe; numbers typed without a country code get one from the
// lead's country (India when unknown — most CRM leads). Too-short input → undefined.
export function normalizePhone(phone, country) {
  if (phone == null) return undefined;
  const raw = String(phone).trim();
  let digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  const code = DIAL_CODES[String(country || "").trim().toLowerCase()] || "91";
  digits = digits.replace(/^0+/, "");
  if (digits.startsWith(code) && digits.length > 10) return `+${digits}`;
  return `+${code}${digits}`;
}
