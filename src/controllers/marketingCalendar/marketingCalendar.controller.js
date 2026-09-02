import { getUnifiedCalendar } from "../../services/marketingCalendar/marketingCalendar.service.js";

// GET /admin/marketing-calendar
export const getCalendarHandler = async (req, res) => {
  try {
    const data = await getUnifiedCalendar({ month: req.query.month });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[MarketingCalendar] getCalendar error:", err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error" });
  }
};
