import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSubmission, MAX_DETAILS, MAX_DETAIL_LENGTH } from "../../src/utils/enquirySubmission.js";
import { generateEnquiryTable } from "../../src/utils/emailTemplate.js";

test("schema fields are kept as fields", () => {
  const { fields, details } = splitSubmission({ name: "Asha", email: "asha@example.com", teamSize: "11-50", source: "agentic-ai" });
  assert.deepEqual(fields, { name: "Asha", email: "asha@example.com", teamSize: "11-50", source: "agentic-ai" });
  assert.deepEqual(details, {});
});

test("answers without a schema field go to details instead of being dropped", () => {
  const { fields, details } = splitSubmission({
    name: "Asha",
    industry: "Banking",
    employeeCount: 250,
    budget: "₹5L+",
    answers: { q1: "a", q2: ["b", "c"] },
  });
  assert.deepEqual(fields, { name: "Asha" });
  assert.deepEqual(details, {
    industry: "Banking",
    employeeCount: "250",
    budget: "₹5L+",
    answers: '{"q1":"a","q2":["b","c"]}',
  });
});

test("a public submission cannot set staff-only pipeline fields", () => {
  const { fields, details } = splitSubmission({
    name: "Mallory",
    status: "won",
    aiScore: 100,
    assignedTo: "boss@technohana.in",
    crmLeadId: "64b000000000000000000000",
    activities: [{ type: "created" }],
    notes: "call after 5pm",
  });
  assert.deepEqual(fields, { name: "Mallory" });
  assert.equal(details.status, "won");
  assert.equal(details.notes, "call after 5pm");
  assert.equal(details.aiScore, "100");
});

test("ids, empty values and unsafe keys are skipped", () => {
  const { fields, details } = splitSubmission({
    _id: "x", __v: 3, details: { status: "won" },
    name: "Asha", phone: "", company: null,
    $where: "1", "a.b": "dotted", ["k".repeat(61)]: "long key",
  });
  assert.deepEqual(fields, { name: "Asha" });
  assert.deepEqual(details, {});
});

test("details are capped in count and length", () => {
  const many = Object.fromEntries(Array.from({ length: MAX_DETAILS + 5 }, (_, i) => [`extra${i}`, "v"]));
  assert.equal(Object.keys(splitSubmission(many).details).length, MAX_DETAILS);
  const { details } = splitSubmission({ message2: "x".repeat(MAX_DETAIL_LENGTH + 50) });
  assert.equal(details.message2.length, MAX_DETAIL_LENGTH);
});

test("the sales notification lists details and escapes visitor input", () => {
  const html = generateEnquiryTable({
    name: "<script>alert(1)</script>",
    details: new Map([["employeeCount", "250"], ["trainingPeriod", "Q1 2027"]]),
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Employee count"));
  assert.ok(html.includes("Training Period"), "known keys keep their label when stored in details");
  assert.ok(html.includes("Q1 2027"));
});
