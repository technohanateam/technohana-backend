import {
  getCalendar,
  scheduleOpportunity,
  rescheduleOpportunity,
  unscheduleOpportunity,
} from "../../services/contentFactory/contentCalendar.service.js";

export const getCalendarHandler = async (req, res) => {
  try {
    const data = await getCalendar({ month: req.query.month });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[ContentFactory] getCalendar error:", err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error" });
  }
};

export const scheduleHandler = async (req, res) => {
  try {
    const { scheduledAt } = req.body || {};
    const { opportunity, blog } = await scheduleOpportunity(req.params.opportunityId, scheduledAt);
    return res.json({ success: true, data: { opportunity, blog }, message: "Scheduled" });
  } catch (err) {
    console.error("[ContentFactory] scheduleOpportunity error:", err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error" });
  }
};

export const rescheduleHandler = async (req, res) => {
  try {
    const { scheduledAt } = req.body || {};
    const { opportunity, blog } = await rescheduleOpportunity(req.params.opportunityId, scheduledAt);
    return res.json({ success: true, data: { opportunity, blog }, message: "Rescheduled" });
  } catch (err) {
    console.error("[ContentFactory] rescheduleOpportunity error:", err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error" });
  }
};

export const unscheduleHandler = async (req, res) => {
  try {
    const { opportunity, blog } = await unscheduleOpportunity(req.params.opportunityId);
    return res.json({ success: true, data: { opportunity, blog }, message: "Unscheduled" });
  } catch (err) {
    console.error("[ContentFactory] unscheduleOpportunity error:", err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error" });
  }
};
