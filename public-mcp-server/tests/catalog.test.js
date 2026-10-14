import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDb } from './fakeDb.js';
import { searchCourses, getCourseDetail, findPublicCourse, AmbiguousCourseError } from '../catalog.js';

let db;
beforeEach(() => { db = installFakeDb(); });
afterEach(() => db.restore());

const FORBIDDEN = ['_id', 'instructorId', 'createdAt', 'updatedAt', 'logo', 'videoId', 'catcls', 'noStudents', 'rating', 'price', 'prices'];

test('search never returns playbook courses', async () => {
  const all = await searchCourses({ category: 'Atlassian', limit: 20 });
  assert.deepEqual(all.map((c) => c.id).sort(), ['confluence-pro', 'jira-fundamentals']);
  const byText = await searchCourses({ query: 'playbook', limit: 20 });
  assert.equal(byText.length, 0);
});

test('search results are bounded and use the allowlisted shape', async () => {
  const [first, ...rest] = await searchCourses({ category: 'Atlassian', limit: 1 });
  assert.equal(rest.length, 0);
  assert.deepEqual(Object.keys(first).sort(), ['category', 'difficulty', 'id', 'slug', 'summary', 'title']);
  assert.ok(first.summary.length <= 301);
});

test('search treats category as literal text, not a pattern', async () => {
  const res = await searchCourses({ category: '.*', limit: 20 });
  assert.equal(res.length, 0);
});

test('every query carries the playbook exclusion', async () => {
  await searchCourses({ limit: 5 });
  await getCourseDetail('jira-fundamentals');
  const hasExclusion = (f) => f.id?.$not instanceof RegExp || f.$and?.some(hasExclusion);
  for (const { filter } of db.calls) assert.ok(hasExclusion(filter), JSON.stringify(filter));
});

test('course details expose no internal fields', async () => {
  const detail = await getCourseDetail('jira-fundamentals');
  assert.equal(detail.title, 'Jira Fundamentals');
  assert.equal(detail.listPriceUsd, 100);
  for (const key of FORBIDDEN) assert.ok(!(key in detail), `${key} must not be returned`);
  assert.deepEqual(detail.modules, [{ title: 'Intro', topics: ['What is Jira'] }]);
});

test('unknown and playbook courses return null', async () => {
  assert.equal(await getCourseDetail('does-not-exist'), null);
  assert.equal(await getCourseDetail('playbook-secret'), null);
});

test('an identifier matching two courses is rejected', async () => {
  await assert.rejects(findPublicCourse('shared-slug'), AmbiguousCourseError);
});
