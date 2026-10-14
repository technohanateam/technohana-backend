import Course from '../../src/models/course.model.js';
import Coupon from '../../src/models/coupon.model.js';

export const COURSES = [
  {
    _id: 'oid-1', id: 'jira-fundamentals', courseSlug: 'jira-fundamentals', courseTitle: 'Jira Fundamentals',
    category: 'Atlassian', categoryGroup: 'Tools', difficulty: 'Beginner', language: 'English', instructor: 'A. Trainer',
    instructorId: 'secret-instructor-id', overview: 'Learn Jira. '.repeat(60), courseObjective: 'Obj', courseOutcomes: 'Out',
    whatWillYouLearn: ['Boards'], prerequisites: [], requirements: [], targetAudience: ['PMs'],
    modules: [{ moduleTitle: 'Intro', content: ['What is Jira'] }], courseDays: 'Sat-Sun', courseTime: '10:00', courseModules: '8',
    labs: 'Yes', prices: { inr: 5000, usd: 100, aed: 300, gbp: 80, eur: 90 }, price: '5000',
    logo: 'logo.png', videoId: 'vid', catcls: 'x', noStudents: '999', rating: '4.9',
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    _id: 'oid-2', id: 'confluence-pro', courseSlug: 'confluence-pro', courseTitle: 'Confluence Pro', category: 'Atlassian',
    difficulty: 'Advanced', overview: 'Docs', prices: { inr: 4000, usd: 80, aed: 250, gbp: 60, eur: 70 },
  },
  {
    _id: 'oid-3', id: 'playbook-secret', courseSlug: 'playbook-secret', courseTitle: 'Playbook Internal', category: 'Atlassian',
    difficulty: 'Beginner', overview: 'Internal', prices: { inr: 1, usd: 1, aed: 1, gbp: 1, eur: 1 },
  },
  {
    _id: 'oid-4', id: 'dup-a', courseSlug: 'shared-slug', courseTitle: 'Dup A', category: 'Other', prices: { inr: 1, usd: 10, aed: 1, gbp: 1, eur: 1 },
  },
  {
    _id: 'oid-5', id: 'dup-b', courseSlug: 'shared-slug', courseTitle: 'Dup B', category: 'Other', prices: { inr: 1, usd: 10, aed: 1, gbp: 1, eur: 1 },
  },
  {
    _id: 'oid-6', id: 'no-usd', courseSlug: 'no-usd', courseTitle: 'No USD Price', category: 'Misc', prices: { inr: 5000 },
  },
];

export const COUPONS = {
  SAVE10: { code: 'SAVE10', discountPercent: 10 },
  BIG40: { code: 'BIG40', discountPercent: 40 },
  EXPIRED: { code: 'EXPIRED', discountPercent: 50, expired: true },
};

const matches = (doc, filter) =>
  Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return cond.every((sub) => matches(doc, sub));
    if (key === '$text') return String(doc.courseTitle).toLowerCase().includes(String(cond.$search).toLowerCase());
    if (cond && cond.$not instanceof RegExp) return !cond.$not.test(doc[key] ?? '');
    if (cond instanceof RegExp) return cond.test(doc[key] ?? '');
    return doc[key] === cond;
  });

const project = (doc, fields) => {
  if (typeof fields !== 'string') return { ...doc };
  const keep = new Set(fields.split(/\s+/).filter(Boolean));
  return Object.fromEntries(Object.entries(doc).filter(([k]) => keep.has(k)));
};

export function installFakeDb() {
  const calls = [];
  const original = { find: Course.find, findOne: Coupon.findOne };

  Course.find = (filter = {}, projection) => {
    calls.push({ filter, projection });
    let fields;
    let max = Infinity;
    const chain = {
      select(f) { fields = f; return chain; },
      sort() { return chain; },
      limit(n) { max = n; return chain; },
      maxTimeMS() { return chain; },
      async lean() {
        const rows = COURSES.filter((d) => matches(d, filter)).slice(0, max);
        return rows.map((d) => project(d, fields ?? (typeof projection === 'string' ? projection : undefined)));
      },
    };
    return chain;
  };

  Coupon.findOne = async ({ code }) => {
    const c = COUPONS[code];
    if (!c) return null;
    return {
      ...c,
      isActive: true,
      hasStarted: () => true,
      isExpired: () => Boolean(c.expired),
      isExhausted: () => false,
      isValidForCurrency: () => true,
    };
  };

  return {
    calls,
    restore() {
      Course.find = original.find;
      Coupon.findOne = original.findOne;
    },
  };
}
