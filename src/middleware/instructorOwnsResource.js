import mongoose from "mongoose";
import Batch from "../models/batch.model.js";
import Session from "../models/session.model.js";
import CourseMaterial from "../models/courseMaterial.model.js";

// Ownership loaders for the instructor teaching routes.
//
// Three rules these enforce, and the reasons they are rules:
//
// 1. Ownership is a FILTER, never a post-hoc comparison. Every lookup puts
//    instructorId inside the query, so a resource belonging to someone else is
//    indistinguishable from one that does not exist. That also means these return
//    404, not 403 — a 403 confirms the id is real and makes batches enumerable.
//
// 2. The instructor id comes from req.instructor.id (set by authenticateInstructor
//    from the verified token) and never from the request body or query.
//
// 3. Session ownership resolves through the parent BATCH, not through the
//    denormalized Session.instructorId. That copy exists only to serve the
//    cross-batch "upcoming sessions" index; if an admin reassigns a batch and the
//    cascade lags or fails, authorizing off the stale copy would leave the former
//    instructor with write access.

const notFound = (res, what) =>
  res.status(404).json({ success: false, message: `${what} not found` });

const badId = (res) =>
  res.status(400).json({ success: false, message: "Malformed id" });

export const loadOwnedBatch = async (req, res, next) => {
  const { batchId } = req.params;
  if (!mongoose.isValidObjectId(batchId)) return badId(res);

  try {
    const batch = await Batch.findOne({ _id: batchId, instructorId: req.instructor.id });
    if (!batch) return notFound(res, "Batch");
    req.batch = batch;
    return next();
  } catch {
    return res.status(500).json({ success: false, message: "Failed to load batch" });
  }
};

export const loadOwnedSession = async (req, res, next) => {
  const { sessionId } = req.params;
  if (!mongoose.isValidObjectId(sessionId)) return badId(res);

  try {
    const session = await Session.findById(sessionId);
    if (!session) return notFound(res, "Session");

    // Deliberately a second query against Batch — see rule 3 above.
    const batch = await Batch.findOne({ _id: session.batchId, instructorId: req.instructor.id });
    if (!batch) return notFound(res, "Session");

    req.classSession = session;
    req.batch = batch;
    return next();
  } catch {
    return res.status(500).json({ success: false, message: "Failed to load session" });
  }
};

export const loadOwnedMaterial = async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badId(res);

  try {
    const material = await CourseMaterial.findOne({
      _id: id,
      instructorId: req.instructor.id,
      deletedAt: null,
    });
    if (!material) return notFound(res, "Material");
    req.material = material;
    return next();
  } catch {
    return res.status(500).json({ success: false, message: "Failed to load material" });
  }
};

/**
 * Resolve a body-supplied batchId to a batch this instructor owns.
 * Used on material create, where the scope arrives in the body rather than the path.
 * Returns { ok: true, batch }| { ok: false, status, message }.
 */
export const resolveOwnedBatchFromBody = async (batchId, instructorId) => {
  if (!batchId) return { ok: true, batch: null }; // course-wide material
  if (!mongoose.isValidObjectId(batchId)) return { ok: false, status: 400, message: "Malformed batchId" };

  const batch = await Batch.findOne({ _id: batchId, instructorId });
  if (!batch) return { ok: false, status: 404, message: "Batch not found" };
  return { ok: true, batch };
};
