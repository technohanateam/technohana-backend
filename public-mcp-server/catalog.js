import Course from '../src/models/course.model.js';
import { computeQuote } from '../src/utils/pricing.js';

const PUBLIC_FILTER = { id: { $not: /^playbook-/i } };
const MAX_TIME_MS = 5000;
const SUMMARY_LENGTH = 300;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactCI = (s) => new RegExp(`^${escapeRegex(s)}$`, 'i');

const SEARCH_FIELDS = 'id courseSlug courseTitle category difficulty overview';
const DETAIL_FIELDS =
  'id courseSlug courseTitle category categoryGroup difficulty language instructor overview courseObjective courseOutcomes ' +
  'whatWillYouLearn prerequisites requirements targetAudience modules courseDays courseTime courseModules labs prices';

const summarize = (text) => {
  if (!text) return '';
  const t = String(text).trim();
  return t.length > SUMMARY_LENGTH ? `${t.slice(0, SUMMARY_LENGTH)}…` : t;
};

const strings = (arr) => (Array.isArray(arr) ? arr.map(String) : []);

export const toSearchResult = (c) => ({
  id: c.id ?? '',
  slug: c.courseSlug ?? '',
  title: c.courseTitle,
  category: c.category ?? '',
  difficulty: c.difficulty ?? '',
  summary: summarize(c.overview),
});

export const toCourseDetail = (c) => ({
  id: c.id ?? '',
  slug: c.courseSlug ?? '',
  title: c.courseTitle,
  category: c.category ?? '',
  categoryGroup: c.categoryGroup ?? '',
  difficulty: c.difficulty ?? '',
  language: c.language ?? '',
  instructor: c.instructor ?? '',
  overview: c.overview ?? '',
  objective: c.courseObjective ?? '',
  outcomes: c.courseOutcomes ?? '',
  whatYouWillLearn: strings(c.whatWillYouLearn),
  prerequisites: strings(c.prerequisites),
  requirements: strings(c.requirements),
  targetAudience: strings(c.targetAudience),
  modules: (c.modules ?? []).map((m) => ({ title: m.moduleTitle ?? '', topics: strings(m.content) })),
  schedule: { days: c.courseDays ?? '', time: c.courseTime ?? '', modules: c.courseModules ?? '' },
  labs: c.labs ?? '',
  listPriceUsd: typeof c.prices?.usd === 'number' ? c.prices.usd : null,
});

export async function searchCourses({ query, category, difficulty, limit }) {
  const filter = { ...PUBLIC_FILTER };
  if (category) filter.category = exactCI(category);
  if (difficulty) filter.difficulty = exactCI(difficulty);

  let q;
  if (query) {
    filter.$text = { $search: query };
    q = Course.find(filter, { score: { $meta: 'textScore' } })
      .select(SEARCH_FIELDS)
      .sort({ score: { $meta: 'textScore' } });
  } else {
    q = Course.find(filter).select(SEARCH_FIELDS).sort({ courseTitle: 1 });
  }
  const docs = await q.limit(limit).maxTimeMS(MAX_TIME_MS).lean();
  return docs.map(toSearchResult);
}

// Slug is tried before id, mirroring GET /courses/:id. Returns null when nothing
// matches and throws AmbiguousCourseError when a key matches several courses.
export class AmbiguousCourseError extends Error {}
export class PriceUnavailableError extends Error {}

export async function findPublicCourse(key, fields = DETAIL_FIELDS) {
  for (const field of ['courseSlug', 'id']) {
    const docs = await Course.find({ $and: [PUBLIC_FILTER, { [field]: key }] })
      .select(fields)
      .limit(2)
      .maxTimeMS(MAX_TIME_MS)
      .lean();
    if (docs.length > 1) throw new AmbiguousCourseError();
    if (docs.length === 1) return docs[0];
  }
  return null;
}

export const getCourseDetail = async (key) => {
  const course = await findPublicCourse(key);
  return course ? toCourseDetail(course) : null;
};

const toMajor = (minor) => Math.round(minor) / 100;

export async function quoteCourse({ courseKey, participants, couponCode }) {
  const course = await findPublicCourse(courseKey, 'id courseSlug courseTitle');
  if (!course || !course.id) return null;

  const group = participants > 1;
  const quote = await computeQuote({
    courseId: course.id,
    enrollmentType: group ? 'group' : 'individual',
    participants,
    currency: 'usd',
    couponCode: couponCode || undefined,
  }).catch((err) => {
    throw /Price not configured/.test(err.message) ? new PriceUnavailableError() : err;
  });

  const result = {
    courseId: course.id,
    courseTitle: course.courseTitle,
    currency: 'USD',
    participants: quote.participants,
    listPricePerPerson: toMajor(quote.originalUnitMinor),
    groupDiscountPercent: quote.discountPercent,
    couponApplied: quote.couponApplied,
    couponDiscountPercent: quote.couponDiscountPercent,
    totalDiscountPercent: quote.totalDiscountPercent,
    pricePerPerson: toMajor(quote.unitAmountMinor),
    total: toMajor(quote.expectedTotalMinor),
    note: 'Estimate only. The final price is confirmed at checkout.',
  };
  if (couponCode && !quote.couponApplied) result.couponMessage = 'The coupon code could not be applied.';
  return result;
}
