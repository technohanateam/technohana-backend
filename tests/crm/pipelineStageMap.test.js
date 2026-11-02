import { test } from "node:test";
import assert from "node:assert/strict";
import { PIPELINE_PLANS, planStageChanges } from "../../src/constants/pipelineStageMap.js";

const seed = (stages) => stages.map((s, i) => ({ order: i + 1, probability: 10, color: "#6B7280", isWon: false, isLost: false, label: s, key: s }));
const SEEDED = {
  individual: seed(["enquiry", "course_suggest", "trial", "enrolled", "lost"]).map((s) => ({ ...s, isWon: s.key === "enrolled", isLost: s.key === "lost" })),
  corporate: seed(["lead", "discovery", "needs_analysis", "skill_gap", "course_recommended", "proposal_sent", "negotiation", "quotation_sent", "purchase_order", "won", "lost"])
    .map((s) => ({ ...s, isWon: s.key === "won", isLost: s.key === "lost" })),
  ai_projects: seed(["prospect", "scoping", "proposal", "contract", "won", "lost"]).map((s) => ({ ...s, isWon: s.key === "won", isLost: s.key === "lost" })),
};

const byOrder = (stages) => stages.slice().sort((a, b) => a.order - b.order).map((s) => s.key);

test("final stage order matches the intended sequence for every pipeline type", () => {
  for (const type of Object.keys(PIPELINE_PLANS)) {
    const { stages } = planStageChanges(SEEDED[type], type);
    assert.deepEqual(byOrder(stages), PIPELINE_PLANS[type].sequence, type);
  }
});

test("existing stages keep key, label, order, probability, colour and won/lost flags", () => {
  for (const type of Object.keys(SEEDED)) {
    const { stages } = planStageChanges(SEEDED[type], type);
    for (const before of SEEDED[type]) {
      const after = stages.find((s) => s.key === before.key);
      const { alias, ...rest } = after;
      assert.deepEqual(rest, before, `${type}/${before.key}`);
    }
  }
});

test("new stages are never won or lost, and have unique keys and orders", () => {
  for (const type of Object.keys(SEEDED)) {
    const { stages, addedKeys } = planStageChanges(SEEDED[type], type);
    assert.ok(addedKeys.length > 0);
    assert.equal(new Set(stages.map((s) => s.key)).size, stages.length);
    assert.equal(new Set(stages.map((s) => s.order)).size, stages.length);
    for (const k of addedKeys) {
      const s = stages.find((x) => x.key === k);
      assert.equal(s.isWon || s.isLost, false);
      assert.ok(s.probability > 0 && s.probability < 100);
    }
    // exactly one won (individual's `enrolled`, others' `won`) and one lost remain
    assert.equal(stages.filter((s) => s.isWon).length, 1);
    assert.equal(stages.filter((s) => s.isLost).length, 1);
  }
});

test("aliases roll legacy and new stages together", () => {
  const corp = planStageChanges(SEEDED.corporate, "corporate").stages;
  const alias = (k) => corp.find((s) => s.key === k).alias;
  assert.equal(alias("needs_analysis"), alias("skill_gap"));
  assert.equal(alias("proposal_sent"), alias("quotation_sent"));
  assert.equal(alias("course_recommended"), alias("qualified_opportunity"));
  assert.equal(alias("won"), undefined); // no alias needed; groups under its own key
  const ind = planStageChanges(SEEDED.individual, "individual").stages;
  assert.equal(ind.find((s) => s.key === "enquiry").alias, "new_lead");
});

test("re-running changes nothing", () => {
  for (const type of Object.keys(SEEDED)) {
    const first = planStageChanges(SEEDED[type], type);
    const second = planStageChanges(first.stages, type);
    assert.deepEqual(second.addedKeys, []);
    assert.deepEqual(second.aliasedKeys, []);
    assert.deepEqual(second.stages, first.stages);
  }
});

test("an admin-edited pipeline is respected: no restoring, no renaming, no overwriting aliases", () => {
  const edited = SEEDED.individual
    .filter((s) => s.key !== "trial")
    .map((s) => (s.key === "enquiry" ? { ...s, label: "Our Enquiry", alias: "custom_alias" } : s));
  const { stages, addedKeys } = planStageChanges(edited, "individual");
  assert.ok(!stages.some((s) => s.key === "trial"));
  assert.equal(stages.find((s) => s.key === "enquiry").label, "Our Enquiry");
  assert.equal(stages.find((s) => s.key === "enquiry").alias, "custom_alias");
  assert.ok(addedKeys.includes("fee_shared"));
  assert.deepEqual(byOrder(stages).filter((k) => PIPELINE_PLANS.individual.sequence.includes(k)),
    PIPELINE_PLANS.individual.sequence.filter((k) => k !== "trial"));
});

test("a stage the admin already created with a plan key is left alone", () => {
  const custom = [...SEEDED.individual, { key: "contacted", label: "Called", order: 9, probability: 5, color: "#111111", isWon: false, isLost: false }];
  const { stages, addedKeys } = planStageChanges(custom, "individual");
  assert.ok(!addedKeys.includes("contacted"));
  assert.equal(stages.find((s) => s.key === "contacted").label, "Called");
});

test("unknown pipeline types are skipped untouched", () => {
  const r = planStageChanges(SEEDED.individual, "certification");
  assert.equal(r.skipped, true);
  assert.equal(r.stages, SEEDED.individual);
});
