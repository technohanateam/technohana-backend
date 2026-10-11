import test from "node:test";
import assert from "node:assert/strict";

import { compileSearchQuery, SearchQueryError } from "../../src/utils/compileSearchQuery.js";
import { classifyQuery } from "../../src/utils/searchQueryClassifier.js";
import { SEARCH_ENTITIES } from "../../src/config/globalSearchEntities.js";

const rejects = (input, fragment) => {
  assert.throws(
    () => compileSearchQuery(input),
    (err) => {
      assert.ok(err instanceof SearchQueryError, `expected SearchQueryError, got ${err.name}`);
      if (fragment) {
        assert.match(err.message, new RegExp(fragment, "i"));
      }
      return true;
    }
  );
};

// ── Registry integrity ──────────────────────────────────────────────────────

test("every entity has a model, formatters and disjoint allowlists", () => {
  const keys = new Set();
  for (const e of SEARCH_ENTITIES) {
    assert.ok(!keys.has(e.key), `duplicate entity key ${e.key}`);
    keys.add(e.key);
    assert.ok(e.model?.modelName, `${e.key} has no Mongoose model`);
    assert.equal(typeof e.title, "function", `${e.key} title`);
    assert.equal(typeof e.subtitle, "function", `${e.key} subtitle`);
    assert.equal(typeof e.linkTo, "function", `${e.key} linkTo`);
    assert.ok(e.searchFields.length > 0, `${e.key} has no searchFields`);
    assert.ok(Object.keys(e.project).length > 0, `${e.key} has an empty projection`);
    for (const g of e.groupable || []) {
      assert.ok(e.filterable[g], `${e.key} groupable "${g}" is not filterable`);
    }
  }
});

test("no projection exposes a secret field", () => {
  const forbidden = [
    "password", "passwordHash", "resetToken", "resetTokenHash", "resetTokenExpiry",
    "enrollmentToken", "razorpayPaymentId", "encryptedRefreshToken", "googleId", "referralCode",
  ];
  for (const e of SEARCH_ENTITIES) {
    for (const field of Object.keys(e.project)) {
      assert.ok(
        !forbidden.includes(field),
        `${e.key} projects the secret field "${field}"`
      );
    }
  }
});

test("every searchable field is a String path in its schema", () => {
  // A regex against a Number or ObjectId path throws a CastError at query time
  // and silently removes that entity from every search result.
  for (const e of SEARCH_ENTITIES) {
    const paths = new Set([
      ...e.searchFields,
      ...Object.values(e.identityFields || {}).flat(),
    ]);
    for (const path of paths) {
      const schemaPath = e.model.schema.path(path);
      assert.ok(schemaPath, `${e.key}.${path} is not a path on ${e.model.modelName}`);
      assert.equal(
        schemaPath.instance,
        "String",
        `${e.key}.${path} is ${schemaPath.instance}, not String — a regex on it will throw a CastError`
      );
    }
  }
});

test("every filterable field exists in its schema with a matching type", () => {
  const EXPECTED = { string: "String", number: "Number", date: "Date", boolean: "Boolean", enum: "String" };
  for (const e of SEARCH_ENTITIES) {
    for (const [field, spec] of Object.entries(e.filterable)) {
      const schemaPath = e.model.schema.path(field);
      assert.ok(schemaPath, `${e.key}.${field} is not a path on ${e.model.modelName}`);
      assert.equal(
        schemaPath.instance,
        EXPECTED[spec.type],
        `${e.key}.${field} is declared ${spec.type} but the schema says ${schemaPath.instance}`
      );
    }
  }
});

test("declared enum values match the schema's own enum", () => {
  for (const e of SEARCH_ENTITIES) {
    for (const [field, spec] of Object.entries(e.filterable)) {
      if (spec.type !== "enum") continue;
      const schemaValues = e.model.schema.path(field)?.enumValues || [];
      if (schemaValues.length === 0) continue; // registry-only enum, nothing to compare
      for (const v of spec.values) {
        assert.ok(
          schemaValues.includes(v),
          `${e.key}.${field} declares "${v}", which the schema does not allow`
        );
      }
    }
  }
});

test("isDeleted is never filterable, so baseFilter cannot be overridden", () => {
  for (const e of SEARCH_ENTITIES) {
    assert.ok(!e.filterable.isDeleted, `${e.key} exposes isDeleted as a filter`);
  }
});

// ── Accepted queries ────────────────────────────────────────────────────────

test("compiles a plain equality filter", () => {
  const c = compileSearchQuery({
    entity: "enrollment",
    mode: "list",
    filters: [{ field: "status", op: "eq", value: "completed" }],
  });
  assert.equal(c.entityKey, "enrollment");
  assert.deepEqual(c.filter, { $and: [{ status: "completed" }] });
  assert.equal(c.limit, 25);
  assert.equal(c.projection, SEARCH_ENTITIES[0].project);
});

test("enum values are matched case-insensitively and stored canonically", () => {
  const c = compileSearchQuery({
    entity: "enquiry",
    mode: "count",
    filters: [{ field: "status", op: "eq", value: "WON" }],
  });
  assert.deepEqual(c.filter, { $and: [{ status: "won" }] });
});

test("contains escapes regex metacharacters instead of executing them", () => {
  const c = compileSearchQuery({
    entity: "course",
    mode: "list",
    filters: [{ field: "category", op: "contains", value: "C++ (.*)" }],
  });
  const regex = c.filter.$and[0].category;
  assert.ok(regex instanceof RegExp);
  assert.ok(regex.test("Intro to C++ (.*) basics"));
  assert.ok(!regex.test("anything else"), "metacharacters must not match arbitrary text");
});

test("a date range compiles to two clauses on the same field", () => {
  const c = compileSearchQuery({
    entity: "order",
    mode: "count",
    filters: [
      { field: "createdAt", op: "gte", value: "2026-01-01" },
      { field: "createdAt", op: "lte", value: "2026-01-31" },
    ],
  });
  assert.equal(c.filter.$and.length, 2);
  assert.ok(c.filter.$and[0].createdAt.$gte instanceof Date);
  assert.ok(c.filter.$and[1].createdAt.$lte instanceof Date);
});

// No searchable collection is soft-deleted since the CRM entities left admin
// search, so these two give one a soft-delete baseFilter for the test.
const withSoftDelete = (key, fn) => {
  const entity = SEARCH_ENTITIES.find((e) => e.key === key);
  const original = entity.baseFilter;
  entity.baseFilter = { isDeleted: { $ne: true } };
  try {
    fn();
  } finally {
    entity.baseFilter = original;
  }
};

test("baseFilter is appended for soft-deleted collections", () => {
  withSoftDelete("enquiry", () => {
    const c = compileSearchQuery({
      entity: "enquiry",
      mode: "count",
      filters: [{ field: "aiScore", op: "gt", value: 50 }],
    });
    assert.deepEqual(c.filter.$and.at(-1), { isDeleted: { $ne: true } });
  });
});

test("baseFilter survives a query with no filters", () => {
  withSoftDelete("order", () => {
    const c = compileSearchQuery({ entity: "order", mode: "count" });
    assert.deepEqual(c.filter, { isDeleted: { $ne: true } });
  });
});

test("group mode resolves a declared groupable field", () => {
  const c = compileSearchQuery({ entity: "enrollment", mode: "group", groupBy: "city" });
  assert.equal(c.groupBy, "city");
});

test("limit is clamped rather than rejected", () => {
  assert.equal(compileSearchQuery({ entity: "blog", mode: "list", limit: 10000 }).limit, 100);
  assert.equal(compileSearchQuery({ entity: "blog", mode: "list", limit: 7 }).limit, 7);
});

// ── Rejected queries ────────────────────────────────────────────────────────

test("rejects an unknown entity", () => {
  rejects({ entity: "seogscmetrics", mode: "list" }, "not a searchable collection");
});

test("a missing entity gets a usable message, not \"undefined\"", () => {
  // Happens when the model declines to map the question onto anything exposed
  // (e.g. "show me admin password hashes") and returns an empty tool input.
  for (const input of [{ mode: "list" }, { entity: "", mode: "list" }, { entity: null, mode: "list" }]) {
    assert.throws(
      () => compileSearchQuery(input),
      (err) => {
        assert.equal(err.code, "no_entity");
        assert.doesNotMatch(err.message, /undefined|null/);
        return true;
      }
    );
  }
});

test("rejects an unknown mode", () => {
  rejects({ entity: "blog", mode: "drop" }, "unknown mode");
});

test("rejects a field that is not in the entity's filterable allowlist", () => {
  rejects({ entity: "enrollment", mode: "list", filters: [{ field: "password", op: "eq", value: "x" }] }, "cannot be used");
});

test("rejects a field carrying a mongo operator", () => {
  rejects({ entity: "enrollment", mode: "list", filters: [{ field: "$where", op: "eq", value: "1" }] }, "not allowed");
});

test("rejects prototype-walking field names", () => {
  for (const field of ["__proto__", "constructor", "toString"]) {
    rejects({ entity: "enrollment", mode: "list", filters: [{ field, op: "eq", value: "x" }] });
  }
});

test("rejects an operator outside the allowlist", () => {
  rejects({ entity: "blog", mode: "list", filters: [{ field: "category", op: "$where", value: "1" }] }, "not allowed");
  rejects({ entity: "blog", mode: "list", filters: [{ field: "category", op: "regex", value: "^a" }] }, "not allowed");
});

test("rejects an object as a scalar filter value (operator injection)", () => {
  rejects({ entity: "enrollment", mode: "count", filters: [{ field: "city", op: "eq", value: { $ne: null } }] }, "single plain value");
  rejects({ entity: "enrollment", mode: "count", filters: [{ field: "city", op: "eq", value: null }] }, "single plain value");
});

test("rejects an unparseable date", () => {
  rejects({ entity: "order", mode: "count", filters: [{ field: "createdAt", op: "gte", value: "last tuesday" }] }, "expects a date");
});

test("rejects a non-numeric number", () => {
  rejects({ entity: "order", mode: "count", filters: [{ field: "expectedTotalMinor", op: "gt", value: "a lot" }] }, "expects a number");
});

test("rejects an enum value outside the declared set", () => {
  rejects({ entity: "enquiry", mode: "count", filters: [{ field: "status", op: "eq", value: "archived" }] }, "not a valid status");
});

test("rejects a range operator on a string field", () => {
  rejects({ entity: "blog", mode: "count", filters: [{ field: "category", op: "gt", value: "a" }] }, "cannot be used on the string");
});

test("rejects contains on a non-string field", () => {
  rejects({ entity: "order", mode: "count", filters: [{ field: "expectedTotalMinor", op: "contains", value: "5" }] }, "cannot be used on the number");
});

test("rejects an oversized in list", () => {
  rejects(
    { entity: "blog", mode: "count", filters: [{ field: "category", op: "in", value: Array.from({ length: 500 }, (_, i) => `c${i}`) }] },
    "at most 20"
  );
  rejects({ entity: "blog", mode: "count", filters: [{ field: "category", op: "in", value: [] }] }, "at least one");
  rejects({ entity: "blog", mode: "count", filters: [{ field: "category", op: "in", value: "notalist" }] }, "expects a list");
});

test("rejects more than five filters", () => {
  rejects(
    {
      entity: "enrollment",
      mode: "count",
      filters: Array.from({ length: 6 }, () => ({ field: "city", op: "eq", value: "Dubai" })),
    },
    "at most 5 filters"
  );
});

test("rejects an oversized string value", () => {
  rejects({ entity: "blog", mode: "count", filters: [{ field: "category", op: "eq", value: "x".repeat(500) }] }, "too long");
});

test("rejects group mode without, or with an undeclared, groupBy", () => {
  rejects({ entity: "enrollment", mode: "group" }, "needs a groupBy");
  rejects({ entity: "enrollment", mode: "group", groupBy: "email" }, "cannot be used");
});

test("rejects an attempt to unset a soft-delete filter", () => {
  rejects({ entity: "enquiry", mode: "count", filters: [{ field: "isDeleted", op: "eq", value: false }] }, "cannot be used");
});

test("rejects sorting by an undeclared field", () => {
  rejects({ entity: "blog", mode: "list", sortBy: "slug" }, "cannot be used");
});

// ── Query classifier ────────────────────────────────────────────────────────

test("classifies query types", () => {
  assert.equal(classifyQuery("507f1f77bcf86cd799439011").type, "objectId");
  assert.equal(classifyQuery("Salam@Example.com ").type, "email");
  assert.equal(classifyQuery("salam@example.com").value, "salam@example.com");
  assert.equal(classifyQuery("+971 50 123 4567").type, "phone");
  assert.equal(classifyQuery("+971 50 123 4567").value, "971501234567");
  assert.equal(classifyQuery("DIWALI10").type, "code");
  assert.equal(classifyQuery("Salam").type, "text");
  assert.equal(classifyQuery("Azure Fundamentals").type, "text");
  assert.equal(classifyQuery("   ").type, "empty");
});
