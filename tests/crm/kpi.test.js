import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../../src/services/metricsService.js", { namedExports: { getExecSummary: async () => ({}) } });
mock.module("../../src/models/crm/kpiTarget.model.js", {
  defaultExport: {},
  namedExports: { KPI_METRICS: ["revenue_collected", "revenue_booked", "revenue_combined", "leads_created", "leads_qualified", "deals_won", "enrolments", "conversion_rate"] },
});

const { periodBounds, previousPeriod, elapsedFraction, evaluateKpi } = await import("../../src/services/kpiService.js");
const { cleanKpiBody } = await import("../../src/controllers/crmKpi.controller.js");

test("period helpers handle month ends and year boundaries", () => {
  assert.deepEqual(periodBounds("2027-02"), { from: "2027-02-01", to: "2027-02-28" });
  assert.equal(periodBounds("2028-02").to, "2028-02-29");
  assert.equal(previousPeriod("2027-01"), "2026-12");
  assert.equal(previousPeriod("2027-03"), "2027-02");
});

test("elapsedFraction is 0 before, 1 after, partial during the period", () => {
  assert.equal(elapsedFraction("2027-01", new Date("2026-12-15T00:00:00Z")), 0);
  assert.equal(elapsedFraction("2027-01", new Date("2027-03-01T00:00:00Z")), 1);
  const mid = elapsedFraction("2027-01", new Date("2027-01-16T12:00:00Z"));
  assert.ok(mid > 0.45 && mid < 0.55);
});

test("evaluateKpi reports variance, status and trend from real actuals", () => {
  const t = { target: 1000, unit: "count", period: "2027-01" };
  const late = new Date("2027-02-05T00:00:00Z");
  assert.equal(evaluateKpi(t, 1200, 900, late).status, "achieved");
  assert.equal(evaluateKpi(t, 400, 900, late).status, "behind");
  assert.equal(evaluateKpi(t, 400, 900, late).trend, "down");
  assert.equal(evaluateKpi(t, 400, 900, late).variance, -600);
  assert.equal(evaluateKpi(t, 500, 500, new Date("2027-01-16T12:00:00Z")).status, "on_track");
});

test("missing data is no_data, never zero", () => {
  const r = evaluateKpi({ target: 15, unit: "percent", period: "2027-01" }, null, null);
  assert.equal(r.status, "no_data");
  assert.equal(r.actual, null);
});

test("percent targets are judged against the full target, not paced", () => {
  const t = { target: 15, unit: "percent", period: "2027-01" };
  assert.equal(evaluateKpi(t, 5, null, new Date("2027-01-31T00:00:00Z")).status, "behind");
});

test("cleanKpiBody validates and derives the unit server-side", () => {
  const ok = cleanKpiBody({ label: "x", metric: "revenue_combined", period: "2027-01", target: 500000000, unit: "count" });
  assert.equal(ok.fields.unit, "money");
  assert.ok(cleanKpiBody({ label: "x", metric: "bogus", period: "2027-01", target: 1 }).error);
  assert.ok(cleanKpiBody({ label: "x", metric: "deals_won", period: "2027-13", target: 1 }).error);
  assert.ok(cleanKpiBody({ label: "x", metric: "deals_won", period: "2027-01", target: -1 }).error);
  assert.ok(cleanKpiBody({ label: "x", metric: "deals_won", period: "2027-01", target: "5" }).error);
  assert.ok(cleanKpiBody({ label: "x", metric: "deals_won", period: "2027-01", target: 1.5 }).error);
  assert.equal(cleanKpiBody({ label: "x", metric: "conversion_rate", period: "2027-01", target: 12.5 }).fields.target, 12.5);
  assert.equal(cleanKpiBody({ target: 12.5 }, { partial: true }).fields.target, 12.5);
  assert.ok(cleanKpiBody({ businessUnit: "retail" }, { partial: true }).error);
});

test("variance is rounded so float subtraction doesn't leak into the UI", () => {
  const r = evaluateKpi({ target: 15, unit: "percent", period: "2027-01" }, 16.7, null);
  assert.equal(r.variance, 1.7);
  assert.equal(evaluateKpi({ target: 500000, unit: "money", period: "2027-01" }, 450000, null).variance, -50000);
});
