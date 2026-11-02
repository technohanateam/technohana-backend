import { test } from "node:test";
import assert from "node:assert/strict";
import CRMDeal from "../../src/models/crm/crmDeal.model.js";
import CRMLead from "../../src/models/crm/crmLead.model.js";
import { Order } from "../../src/models/order.model.js";
import { businessUnitForOrder } from "../../src/constants/businessUnit.js";

test("deals and leads default to unassigned and reject unknown units", () => {
  const deal = new CRMDeal({ title: "t", pipeline: "65f1c2a4e4b0a1b2c3d4e5f6", stageKey: "lead" });
  assert.equal(deal.businessUnit, null);
  assert.equal(deal.validateSync(), undefined);
  deal.businessUnit = "retail";
  assert.ok(deal.validateSync().errors.businessUnit);

  assert.equal(new CRMLead({ name: "x" }).businessUnit, null);
});

test("orders default to b2c", () => {
  assert.equal(new Order({ orderId: "o1", invoiceNumber: "i1" }).businessUnit, "b2c");
  assert.equal(businessUnitForOrder({}), "b2c");
});
