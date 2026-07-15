import DripSequence from "../models/dripSequence.model.js";

export const getAllDripSequences = async (req, res) => {
  try {
    const sequences = await DripSequence.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: sequences });
  } catch (error) {
    console.error("Error fetching drip sequences:", error);
    return res.status(500).json({ success: false, message: "Error fetching drip sequences" });
  }
};

export const getDripSequence = async (req, res) => {
  try {
    const seq = await DripSequence.findById(req.params.id);
    if (!seq) return res.status(404).json({ success: false, message: "Drip sequence not found" });
    return res.json({ success: true, data: seq });
  } catch (error) {
    console.error("Error fetching drip sequence:", error);
    return res.status(500).json({ success: false, message: "Error fetching drip sequence" });
  }
};

export const createDripSequence = async (req, res) => {
  try {
    const { name, description, triggerEvent, steps, fromName, fromEmail } = req.body;

    if (!name || !triggerEvent) {
      return res.status(400).json({ success: false, message: "Name and trigger event are required" });
    }

    if (!steps || steps.length === 0) {
      return res.status(400).json({ success: false, message: "At least one step is required" });
    }

    const numberedSteps = steps.map((step, i) => ({ ...step, stepNumber: i + 1 }));

    const seq = new DripSequence({
      name,
      description,
      triggerEvent,
      steps: numberedSteps,
      fromName: fromName || "Technohana",
      fromEmail: fromEmail || "noreply@technohana.in",
      createdBy: req.admin?._id,
      createdByRole: req.admin?.role,
      status: "draft",
    });

    await seq.save();
    return res.status(201).json({ success: true, message: "Drip sequence created", data: seq });
  } catch (error) {
    console.error("Error creating drip sequence:", error);
    return res.status(500).json({ success: false, message: "Error creating drip sequence" });
  }
};

export const updateDripSequence = async (req, res) => {
  try {
    const seq = await DripSequence.findById(req.params.id);
    if (!seq) return res.status(404).json({ success: false, message: "Drip sequence not found" });

    if (seq.status === "active") {
      return res.status(400).json({ success: false, message: "Deactivate the sequence before editing" });
    }

    const { name, description, triggerEvent, steps, fromName, fromEmail } = req.body;
    if (name !== undefined) seq.name = name;
    if (description !== undefined) seq.description = description;
    if (triggerEvent !== undefined) seq.triggerEvent = triggerEvent;
    if (fromName !== undefined) seq.fromName = fromName;
    if (fromEmail !== undefined) seq.fromEmail = fromEmail;
    if (steps !== undefined) seq.steps = steps.map((step, i) => ({ ...step, stepNumber: i + 1 }));

    await seq.save();
    return res.json({ success: true, message: "Drip sequence updated", data: seq });
  } catch (error) {
    console.error("Error updating drip sequence:", error);
    return res.status(500).json({ success: false, message: "Error updating drip sequence" });
  }
};

export const deleteDripSequence = async (req, res) => {
  try {
    const seq = await DripSequence.findById(req.params.id);
    if (!seq) return res.status(404).json({ success: false, message: "Drip sequence not found" });
    if (seq.status === "active") {
      return res.status(400).json({ success: false, message: "Deactivate the sequence before deleting" });
    }
    await seq.deleteOne();
    return res.json({ success: true, message: "Drip sequence deleted" });
  } catch (error) {
    console.error("Error deleting drip sequence:", error);
    return res.status(500).json({ success: false, message: "Error deleting drip sequence" });
  }
};

export const activateDripSequence = async (req, res) => {
  try {
    const seq = await DripSequence.findById(req.params.id);
    if (!seq) return res.status(404).json({ success: false, message: "Drip sequence not found" });
    if (seq.steps.length === 0) {
      return res.status(400).json({ success: false, message: "Cannot activate a sequence with no steps" });
    }
    seq.status = "active";
    await seq.save();
    return res.json({ success: true, message: "Drip sequence activated", data: seq });
  } catch (error) {
    console.error("Error activating drip sequence:", error);
    return res.status(500).json({ success: false, message: "Error activating drip sequence" });
  }
};

export const deactivateDripSequence = async (req, res) => {
  try {
    const seq = await DripSequence.findById(req.params.id);
    if (!seq) return res.status(404).json({ success: false, message: "Drip sequence not found" });
    seq.status = "inactive";
    await seq.save();
    return res.json({ success: true, message: "Drip sequence deactivated", data: seq });
  } catch (error) {
    console.error("Error deactivating drip sequence:", error);
    return res.status(500).json({ success: false, message: "Error deactivating drip sequence" });
  }
};
