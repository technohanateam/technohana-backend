import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDb } from './fakeDb.js';
import { refreshPriceCatalog } from '../../src/utils/pricing.js';
import { quoteCourse, PriceUnavailableError } from '../catalog.js';

let db;
beforeEach(async () => {
  db = installFakeDb();
  await refreshPriceCatalog();
});
afterEach(() => db.restore());

const quote = (participants, couponCode, courseKey = 'jira-fundamentals') => quoteCourse({ courseKey, participants, couponCode });

test('individual quote uses the USD list price', async () => {
  const q = await quote(1);
  assert.equal(q.currency, 'USD');
  assert.equal(q.listPricePerPerson, 100);
  assert.equal(q.pricePerPerson, 100);
  assert.equal(q.total, 100);
  assert.equal(q.groupDiscountPercent, 0);
});

test('group tier boundaries: 2-4 15%, 5-9 25%, 10+ 35%', async () => {
  const expected = { 2: 15, 4: 15, 5: 25, 9: 25, 10: 35, 50: 35 };
  for (const [n, pct] of Object.entries(expected)) {
    const q = await quote(Number(n));
    assert.equal(q.groupDiscountPercent, pct, `${n} participants`);
    assert.equal(q.total, Math.round(100 * (1 - pct / 100) * 100) / 100 * Number(n), `${n} total`);
  }
});

test('discounts apply in order: group, then coupon', async () => {
  const q = await quote(5, 'SAVE10');
  assert.equal(q.pricePerPerson, 67.5);
  assert.equal(q.couponApplied, true);
  assert.equal(q.couponDiscountPercent, 10);
  assert.equal(q.total, 337.5);
});

test('combined discounts never go below 50% of list price', async () => {
  const q = await quote(10, 'BIG40');
  assert.equal(q.pricePerPerson, 50);
  assert.equal(q.totalDiscountPercent, 50);
});

test('unknown, expired and malformed coupons are not applied', async () => {
  for (const code of ['NOPE', 'EXPIRED']) {
    const q = await quote(1, code);
    assert.equal(q.couponApplied, false);
    assert.equal(q.couponMessage, 'The coupon code could not be applied.');
    assert.equal(q.total, 100);
  }
});

test('coupon lookup is case-insensitive', async () => {
  const q = await quote(1, 'save10');
  assert.equal(q.couponApplied, true);
});

test('unknown and playbook courses return null', async () => {
  assert.equal(await quote(1, undefined, 'missing'), null);
  assert.equal(await quote(1, undefined, 'playbook-secret'), null);
});

test('quotes can be repeated without changing the result', async () => {
  const a = await quote(5, 'SAVE10');
  const b = await quote(5, 'SAVE10');
  assert.deepEqual(a, b);
});

test('quote output has only customer-facing fields', async () => {
  const q = await quote(3, 'SAVE10');
  assert.deepEqual(Object.keys(q).sort(), [
    'couponApplied', 'couponDiscountPercent', 'courseId', 'courseTitle', 'currency', 'groupDiscountPercent',
    'listPricePerPerson', 'note', 'participants', 'pricePerPerson', 'total', 'totalDiscountPercent',
  ]);
});

test('a course without a USD price reports price unavailable', async () => {
  await assert.rejects(quote(1, undefined, 'no-usd'), PriceUnavailableError);
});
