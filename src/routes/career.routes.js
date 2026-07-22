import express from "express";
import upload from "../middleware/upload.js";
import { listOpenTrainingRequirements, applyToTrainingRequirement } from "../controllers/career.controller.js";

const router = express.Router();

router.get("/career/openings", listOpenTrainingRequirements);

router.post("/career/openings/:id/apply", (req, res, next) => {
  upload.single("resume")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE"
        ? "File too large. Maximum size is 5 MB."
        : err.message || "File upload error.";
      return res.status(400).json({ success: false, message: msg });
    }
    next();
  });
}, applyToTrainingRequirement);

export default router;
