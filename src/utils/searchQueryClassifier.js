// Classifies a raw global-search term so the keyword endpoint only queries the
// fields that could plausibly match. Without this, typing a phone number runs a
// regex over every blog excerpt and course overview in the database.

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;
const CODE = /^[A-Z0-9][A-Z0-9_-]{3,24}$/;

export const classifyQuery = (raw) => {
  const q = typeof raw === "string" ? raw.trim() : "";
  if (!q) return { type: "empty", value: "" };

  if (OBJECT_ID.test(q)) return { type: "objectId", value: q };
  if (EMAIL.test(q)) return { type: "email", value: q.toLowerCase() };
  // Digits-only comparison: admins paste numbers as +971 50 123 4567, the DB
  // stores them however the enrollment form captured them.
  if (PHONE.test(q)) return { type: "phone", value: q.replace(/\D/g, "") };
  // An all-caps token is an order ref, invoice number, coupon or batch code.
  // Mixed case falls through to free text so "Salam" is not treated as a code.
  if (CODE.test(q) && q === q.toUpperCase()) return { type: "code", value: q };

  return { type: "text", value: q };
};

// Which of an entity's fields a given query type should search. Returning an
// empty array means "skip this entity entirely for this query".
export const fieldsForQueryType = (entity, queryType) => {
  const ids = entity.identityFields || {};
  switch (queryType) {
    case "email":
      return ids.email || [];
    case "phone":
      return ids.phone || [];
    case "code":
      return ids.ref || [];
    case "text":
      return entity.searchFields || [];
    default:
      return [];
  }
};
