// Compiles the constrained tool payload Claude produces into a Mongoose query.
//
// This is the security boundary of AI ask mode. Claude never emits a Mongo
// filter, a pipeline, or a field path that reaches the driver unchecked: it
// fills a narrow schema, and everything below rebuilds the query from the
// registry's own allowlists. Operators like $where, $function, $accumulator,
// $merge, $out, $lookup and $unionWith are structurally unreachable because no
// code path here can emit them.
import { getEntity } from "../config/globalSearchEntities.js";
import { buildRegexQuery } from "./escapeRegex.js";

export class SearchQueryError extends Error {
  constructor(message, code = "invalid_query") {
    super(message);
    this.name = "SearchQueryError";
    this.code = code;
  }
}

export const OPERATORS = ["eq", "ne", "contains", "gt", "gte", "lt", "lte", "in", "exists"];
export const MODES = ["list", "count", "group"];

const MAX_FILTERS = 5;
const MAX_IN_VALUES = 20;
const MAX_STRING_LENGTH = 200;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

// Operators that only make sense on an ordered type.
const RANGE_OPS = new Set(["gt", "gte", "lt", "lte"]);

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// A scalar filter value must be a primitive. Rejecting objects here is what
// stops classic NoSQL operator injection: a value of { $ne: null } or
// { $gt: "" } would otherwise be spliced straight into the filter.
const assertPrimitive = (value, field) => {
  if (value === null || typeof value === "object") {
    throw new SearchQueryError(`Filter on "${field}" must be a single plain value.`);
  }
};

const coerceString = (value, field) => {
  assertPrimitive(value, field);
  const str = String(value);
  if (str.length > MAX_STRING_LENGTH) {
    throw new SearchQueryError(`Filter value for "${field}" is too long.`);
  }
  return str;
};

const coerceNumber = (value, field) => {
  assertPrimitive(value, field);
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new SearchQueryError(`Filter on "${field}" expects a number, got "${value}".`);
  }
  return num;
};

const coerceDate = (value, field) => {
  assertPrimitive(value, field);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SearchQueryError(`Filter on "${field}" expects a date, got "${value}". Use an ISO date such as 2026-01-31.`);
  }
  return date;
};

const coerceBoolean = (value, field) => {
  assertPrimitive(value, field);
  if (typeof value === "boolean") return value;
  const str = String(value).toLowerCase();
  if (str === "true") return true;
  if (str === "false") return false;
  throw new SearchQueryError(`Filter on "${field}" expects true or false, got "${value}".`);
};

const coerceEnum = (value, field, spec) => {
  const str = coerceString(value, field);
  const match = (spec.values || []).find((v) => v.toLowerCase() === str.toLowerCase());
  if (!match) {
    throw new SearchQueryError(
      `"${str}" is not a valid ${field}. Allowed values: ${(spec.values || []).join(", ")}.`
    );
  }
  // Return the canonical casing so "Won" matches a stored "won".
  return match;
};

const coerceValue = (value, field, spec) => {
  switch (spec.type) {
    case "number":
      return coerceNumber(value, field);
    case "date":
      return coerceDate(value, field);
    case "boolean":
      return coerceBoolean(value, field);
    case "enum":
      return coerceEnum(value, field, spec);
    case "string":
    default:
      return coerceString(value, field);
  }
};

const resolveField = (entity, field, allowlistName) => {
  if (typeof field !== "string" || !field) {
    throw new SearchQueryError("Every filter needs a field name.");
  }
  if (field.includes("$")) {
    throw new SearchQueryError(`Field "${field}" is not allowed.`, "forbidden_field");
  }
  const allowlist = allowlistName === "groupable" ? entity.groupable || [] : entity.filterable || {};
  const allowed = allowlistName === "groupable"
    ? allowlist.includes(field)
    : has(allowlist, field);
  if (!allowed) {
    const available = allowlistName === "groupable"
      ? (entity.groupable || []).join(", ")
      : Object.keys(entity.filterable || {}).join(", ");
    throw new SearchQueryError(
      `"${field}" cannot be used on ${entity.label}. Available: ${available}.`,
      "forbidden_field"
    );
  }
  return field;
};

const compileFilter = (entity, raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SearchQueryError("Each filter must be an object with field, op and value.");
  }
  const field = resolveField(entity, raw.field, "filterable");
  const spec = entity.filterable[field];
  const op = raw.op;

  if (!OPERATORS.includes(op)) {
    throw new SearchQueryError(`Operator "${op}" is not allowed. Use one of: ${OPERATORS.join(", ")}.`, "forbidden_operator");
  }
  if (RANGE_OPS.has(op) && !["number", "date"].includes(spec.type)) {
    throw new SearchQueryError(`Operator "${op}" cannot be used on the ${spec.type} field "${field}".`);
  }
  if (op === "contains" && !["string", "enum"].includes(spec.type)) {
    throw new SearchQueryError(`Operator "contains" cannot be used on the ${spec.type} field "${field}".`);
  }

  switch (op) {
    case "exists":
      return { [field]: { $exists: coerceBoolean(raw.value, field) } };

    case "in": {
      if (!Array.isArray(raw.value)) {
        throw new SearchQueryError(`Operator "in" on "${field}" expects a list of values.`);
      }
      if (raw.value.length === 0) {
        throw new SearchQueryError(`Operator "in" on "${field}" needs at least one value.`);
      }
      if (raw.value.length > MAX_IN_VALUES) {
        throw new SearchQueryError(`Operator "in" on "${field}" accepts at most ${MAX_IN_VALUES} values.`);
      }
      return { [field]: { $in: raw.value.map((v) => coerceValue(v, field, spec)) } };
    }

    case "contains": {
      // buildRegexQuery escapes every regex metacharacter, so a value of
      // ".*" or "^(a+)+$" is matched literally rather than executed.
      const regex = buildRegexQuery(coerceString(raw.value, field));
      if (!regex) {
        throw new SearchQueryError(`Operator "contains" on "${field}" needs a non-empty value.`);
      }
      return { [field]: regex };
    }

    case "ne":
      return { [field]: { $ne: coerceValue(raw.value, field, spec) } };
    case "gt":
      return { [field]: { $gt: coerceValue(raw.value, field, spec) } };
    case "gte":
      return { [field]: { $gte: coerceValue(raw.value, field, spec) } };
    case "lt":
      return { [field]: { $lt: coerceValue(raw.value, field, spec) } };
    case "lte":
      return { [field]: { $lte: coerceValue(raw.value, field, spec) } };
    case "eq":
    default:
      return { [field]: coerceValue(raw.value, field, spec) };
  }
};

/**
 * @param {object} input the `query_database` tool input produced by Claude
 * @returns {{entity, entityKey, label, mode, filter, projection, sort, limit, groupBy, appliedFilters}}
 * @throws {SearchQueryError}
 */
export const compileSearchQuery = (input) => {
  if (!input || typeof input !== "object") {
    throw new SearchQueryError("No query was produced.");
  }

  // A missing entity means the model could not map the question onto anything
  // searchable (asking for a collection that isn't exposed, or for a field that
  // is never projected). That is a different message from a wrong entity name.
  if (input.entity == null || input.entity === "") {
    throw new SearchQueryError(
      "That data isn't available through search. Try asking about enrollments, enquiries, orders, courses, batches, blogs or coupons.",
      "no_entity"
    );
  }

  const entity = getEntity(input.entity);
  if (!entity) {
    throw new SearchQueryError(`"${input.entity}" is not a searchable collection.`, "unknown_entity");
  }

  const mode = input.mode;
  if (!MODES.includes(mode)) {
    throw new SearchQueryError(`Unknown mode "${mode}". Use list, count or group.`);
  }

  const rawFilters = input.filters ?? [];
  if (!Array.isArray(rawFilters)) {
    throw new SearchQueryError("filters must be a list.");
  }
  if (rawFilters.length > MAX_FILTERS) {
    throw new SearchQueryError(`At most ${MAX_FILTERS} filters are allowed, got ${rawFilters.length}.`);
  }

  const compiled = rawFilters.map((f) => compileFilter(entity, f));

  // Several filters can target the same field (a date range is gte + lte), so
  // they are combined with $and rather than merged into one object where the
  // later key would silently overwrite the earlier one.
  const filter = compiled.length > 0
    ? { $and: [...compiled, entity.baseFilter || {}].filter((c) => Object.keys(c).length > 0) }
    : { ...(entity.baseFilter || {}) };

  // baseFilter is applied last and outside the AI-supplied clauses, so a filter
  // like { field: "isDeleted", op: "eq", value: false } can never unset it.
  // (isDeleted is not in any entity's `filterable` map either, so it is already
  // rejected upstream. This is the second lock on the same door.)

  let groupBy = null;
  if (mode === "group") {
    if (!input.groupBy) {
      throw new SearchQueryError("Grouping needs a groupBy field.");
    }
    groupBy = resolveField(entity, input.groupBy, "groupable");
  }

  let sort = entity.sort || { _id: -1 };
  if (input.sortBy) {
    const sortField = resolveField(entity, input.sortBy, "filterable");
    sort = { [sortField]: input.sortDir === "asc" ? 1 : -1 };
  }

  const requested = Number(input.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return {
    entity,
    entityKey: entity.key,
    label: entity.label,
    mode,
    filter,
    // Always the registry's whitelist. Any projection the model suggested is
    // ignored outright.
    projection: entity.project,
    sort,
    limit,
    groupBy,
    // Echoed back to the admin so they can see what actually ran.
    appliedFilters: rawFilters.map((f) => ({ field: f.field, op: f.op, value: f.value })),
  };
};

/**
 * Runs a compiled query. Every stage is built from literals here; nothing in
 * the pipeline comes from model output except the already-validated field name.
 */
export const runCompiledQuery = async (compiled) => {
  const { entity, mode, filter, projection, sort, limit, groupBy } = compiled;
  const Model = entity.model;

  if (mode === "count") {
    const total = await Model.countDocuments(filter);
    return { mode, total, rows: [] };
  }

  if (mode === "group") {
    // `total` is counted separately rather than summed from `rows`: $limit caps
    // the number of buckets returned, so summing them under-reports the real
    // match count whenever there are more groups than the limit.
    const [buckets, total, groupCount] = await Promise.all([
      Model.aggregate([
        { $match: filter },
        { $group: { _id: `$${groupBy}`, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]),
      Model.countDocuments(filter),
      Model.aggregate([
        { $match: filter },
        { $group: { _id: `$${groupBy}` } },
        { $count: "count" },
      ]),
    ]);
    return {
      mode,
      total,
      groupCount: groupCount[0]?.count ?? buckets.length,
      rows: buckets.map((r) => ({ value: r._id ?? "(not set)", count: r.count })),
    };
  }

  const [rows, total] = await Promise.all([
    Model.find(filter).select(projection).sort(sort).limit(limit).lean(),
    Model.countDocuments(filter),
  ]);
  return { mode, total, rows };
};
