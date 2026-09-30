import mongoose from "mongoose";
import { SEARCH_ENTITIES, getEntity } from "../config/globalSearchEntities.js";
import { classifyQuery, fieldsForQueryType } from "../utils/searchQueryClassifier.js";
import { buildRegexQuery } from "../utils/escapeRegex.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("globalSearch");

const PER_ENTITY_LIMIT = 5;
const MAX_PER_ENTITY_LIMIT = 25;

// A regex against a Number or ObjectId path throws a CastError and takes the
// whole entity out of the results. Rather than trusting the registry to only
// ever list String fields, ask the schema and drop anything else — a wrong
// field becomes a silently skipped field instead of a dead search group.
const stringFieldCache = new Map();

const stringFieldsOnly = (entity, fields) => {
  let allowed = stringFieldCache.get(entity.key);
  if (!allowed) {
    allowed = new Set();
    for (const path of new Set([
      ...(entity.searchFields || []),
      ...Object.values(entity.identityFields || {}).flat(),
    ])) {
      const schemaPath = entity.model.schema.path(path);
      if (schemaPath?.instance === "String") allowed.add(path);
      else logger.warn(`${entity.key}.${path} is not a String path; excluded from keyword search`);
    }
    stringFieldCache.set(entity.key, allowed);
  }
  return fields.filter((f) => allowed.has(f));
};

const escapeRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Phone numbers are stored however the form captured them ("+971 50 123 4567",
// "0501234567"), so a digits-only query cannot match as a substring. Match the
// trailing digits with arbitrary separators allowed between them.
const buildPhoneRegex = (digits) => {
  const tail = digits.slice(-9);
  if (tail.length < 6) return null;
  return new RegExp(tail.split("").join("[^0-9]*"));
};

// Builds the $or for one entity given the classified query. Returns null when
// this entity has no field worth searching for this query type, so a phone
// number never runs a regex over blog excerpts.
const buildEntityFilter = (entity, classified) => {
  if (classified.type === "objectId") {
    return mongoose.isValidObjectId(classified.value)
      ? { _id: new mongoose.Types.ObjectId(classified.value) }
      : null;
  }

  const fields = stringFieldsOnly(entity, fieldsForQueryType(entity, classified.type));
  if (fields.length === 0) return null;

  if (classified.type === "email") {
    // Emails are stored with inconsistent casing across collections, so match
    // case-insensitively but anchored, which is still far cheaper than a
    // substring scan over every text field.
    const regex = new RegExp(`^${escapeRe(classified.value)}$`, "i");
    return { $or: fields.map((f) => ({ [f]: regex })) };
  }

  if (classified.type === "phone") {
    const regex = buildPhoneRegex(classified.value);
    if (!regex) return null;
    return { $or: fields.map((f) => ({ [f]: regex })) };
  }

  const regex = buildRegexQuery(classified.value);
  if (!regex) return null;
  return { $or: fields.map((f) => ({ [f]: regex })) };
};

const withBase = (entity, filter) => {
  const base = entity.baseFilter || {};
  return Object.keys(base).length > 0 ? { $and: [filter, base] } : filter;
};

const shapeHit = (entity, doc) => {
  const id = String(doc._id);
  let title;
  let subtitle;
  let link;
  // A registry formatter should never take the whole palette down over an
  // unexpected shape (a doc missing a nested object, say).
  try {
    title = entity.title(doc);
  } catch {
    title = null;
  }
  try {
    subtitle = entity.subtitle(doc);
  } catch {
    subtitle = "";
  }
  try {
    link = entity.linkTo(doc);
  } catch {
    link = null;
  }
  return { id, title: title || id, subtitle: subtitle || "", link: link || null };
};

const searchEntity = async (entity, classified, limit) => {
  const filter = buildEntityFilter(entity, classified);
  if (!filter) return null;

  const scoped = withBase(entity, filter);
  const [docs, total] = await Promise.all([
    entity.model.find(scoped).select(entity.project).sort(entity.sort || { _id: -1 }).limit(limit).lean(),
    entity.model.countDocuments(scoped),
  ]);

  if (docs.length === 0) return null;

  return {
    entity: entity.key,
    label: entity.label,
    icon: entity.icon,
    total,
    hits: docs.map((d) => shapeHit(entity, d)),
  };
};

/**
 * Keyword search across every registered entity.
 *
 * Runs one capped find + count per entity in parallel rather than a single
 * $unionWith pipeline: each entity keeps its own projection and soft-delete
 * filter, and one slow or failing collection degrades to a `failed` entry
 * instead of taking the whole palette down.
 */
export const keywordSearch = async ({ q, entities, limit } = {}) => {
  const startedAt = Date.now();
  const classified = classifyQuery(q);

  if (classified.type === "empty") {
    return { query: "", queryType: "empty", tookMs: 0, groups: [], failed: [] };
  }

  const requested = Number(limit);
  const perEntity = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_PER_ENTITY_LIMIT)
    : PER_ENTITY_LIMIT;

  // An explicit `entities` list lets the UI drill into one group ("view all")
  // without re-querying the other sixteen.
  const requestedKeys = typeof entities === "string" && entities.trim()
    ? entities.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const targets = requestedKeys
    ? requestedKeys.map(getEntity).filter(Boolean)
    : SEARCH_ENTITIES;

  const settled = await Promise.allSettled(
    targets.map((entity) => searchEntity(entity, classified, perEntity))
  );

  const groups = [];
  const failed = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      if (result.value) groups.push(result.value);
    } else {
      failed.push(targets[i].key);
      logger.error(`keyword search failed for ${targets[i].key}: ${result.reason?.message}`);
    }
  });

  // Entities with an exact-identity hit are what the admin almost always
  // wanted, so order groups by best match density, then by size.
  groups.sort((a, b) => b.hits.length - a.hits.length || a.label.localeCompare(b.label));

  return {
    query: classified.value,
    queryType: classified.type,
    tookMs: Date.now() - startedAt,
    groups,
    failed,
  };
};
