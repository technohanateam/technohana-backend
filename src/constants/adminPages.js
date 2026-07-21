// Canonical registry of admin panel pages. Keep in sync with the frontend
// registry in technohana-frontend-master/src/lib/adminAccess.js.
export const ADMIN_PAGES = [
  "overview",
  "sales-dashboard",
  "sales-pipeline",
  "proposal-builder",
  "proposals",
  "enrollments",
  "enquiries",
  "testimonials",
  "quote-generator",
  "marketing-overview",
  "campaigns",
  "drip-sequences",
  "utm-report",
  "geo-analysis",
  "seo-analysis",
  "blogs",
  "courses",
  "subscribers",
  "referrals",
  "coupons",
  "instructors",
  "training-requirements",
  "team",
  "live-agent",
  "prompt-editor",
  "analytics",
  "ai-risk-reports",
  "crm",
];

export const ADMIN_ROLES = [
  "admin",
  "sales",
  "marketing",
  "super_admin",
  "trainer",
  "accounts",
  "hr",
  "student_support",
  "readonly",
];

export const DEFAULT_PAGES_BY_ROLE = {
  admin: [...ADMIN_PAGES],
  super_admin: [...ADMIN_PAGES],
  sales: [
    "sales-dashboard",
    "sales-pipeline",
    "proposal-builder",
    "proposals",
    "enrollments",
    "enquiries",
    "testimonials",
    "quote-generator",
    "utm-report",
    "courses",
    "referrals",
    "analytics",
    "ai-risk-reports",
    "crm",
    "instructors",
    "training-requirements",
  ],
  // trainer/accounts/hr/student_support/readonly are CRM-only crmRoles — they
  // never get admin-panel pages (see authenticateAdmin.js CRM_ONLY_ROLES block),
  // so no entries here are needed for them.
};

export const computeEffectivePages = (role, extraPages = [], revokedPages = []) => {
  const base = new Set([...(DEFAULT_PAGES_BY_ROLE[role] || []), ...extraPages]);
  for (const page of revokedPages) base.delete(page);
  return [...base].filter((page) => ADMIN_PAGES.includes(page));
};
