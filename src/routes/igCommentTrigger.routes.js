import express from "express";
import mongoose from "mongoose";
import { authenticateAdmin, requireAdmin, requireMarketing, requirePage } from "../middleware/authenticateAdmin.js";
import IgCommentTrigger from "../models/igCommentTrigger.model.js";

const router = express.Router();

router.use(authenticateAdmin, requirePage("social-factory"));

const EDITABLE = ["label", "keywords", "mediaIds", "replyText", "dmText", "linkUrl", "active"];
const pick = (body) => Object.fromEntries(EDITABLE.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));
const validationError = (res, err) =>
  err.name === "ValidationError" ? res.status(400).json({ message: err.message }) : null;
const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ message: "Invalid id" });

router.get("/", requireMarketing, async (_req, res) => {
  res.json(await IgCommentTrigger.find().sort({ createdAt: -1 }).lean());
});

router.post("/", requireMarketing, async (req, res) => {
  try {
    res.status(201).json(await IgCommentTrigger.create(pick(req.body)));
  } catch (err) {
    validationError(res, err) || res.status(500).json({ message: "Could not create trigger" });
  }
});

router.patch("/:id", requireMarketing, validId, async (req, res) => {
  try {
    const trigger = await IgCommentTrigger.findByIdAndUpdate(req.params.id, { $set: pick(req.body) }, { new: true, runValidators: true });
    trigger ? res.json(trigger) : res.status(404).json({ message: "Trigger not found" });
  } catch (err) {
    validationError(res, err) || res.status(500).json({ message: "Could not update trigger" });
  }
});

router.delete("/:id", requireAdmin, validId, async (req, res) => {
  const trigger = await IgCommentTrigger.findByIdAndDelete(req.params.id);
  trigger ? res.json({ message: "Deleted" }) : res.status(404).json({ message: "Trigger not found" });
});

export default router;
