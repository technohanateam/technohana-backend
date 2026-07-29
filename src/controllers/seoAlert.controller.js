import SeoAlert from "../models/seoAlert.model.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

export const listAlerts = async (req, res) => {
  try {
    const { acknowledged } = req.query;
    const query = {};
    if (acknowledged !== undefined) query.acknowledged = acknowledged === "true";

    const alerts = await SeoAlert.find(query).sort({ triggeredAt: -1 }).limit(200).lean();
    return res.json({ success: true, data: alerts });
  } catch (error) {
    console.error("Error listing alerts:", error);
    return res.status(500).json({ success: false, message: "Error listing alerts" });
  }
};

export const acknowledgeAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const alert = await SeoAlert.findByIdAndUpdate(
      id,
      { acknowledged: true, acknowledgedBy: req.admin?.email, acknowledgedAt: new Date() },
      { new: true }
    );
    if (!alert) return res.status(404).json({ success: false, message: "Alert not found" });

    await logSeoAudit(req, "alert.acknowledge", "SeoAlert", id, {});
    return res.json({ success: true, data: alert });
  } catch (error) {
    console.error("Error acknowledging alert:", error);
    return res.status(500).json({ success: false, message: "Error acknowledging alert" });
  }
};
