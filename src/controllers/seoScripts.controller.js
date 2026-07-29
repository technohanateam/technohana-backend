import fs from "fs";
import path from "path";
import { execFile } from "child_process";

const BACKLINK_DIR = process.env.BACKLINK_STRATEGY_DIR || path.resolve("../technohana-frontend-master/backlink-strategy");
const SCRIPTS_DIR = path.join(BACKLINK_DIR, "scripts");

const UNAVAILABLE_MESSAGE =
  "This action requires the backlink-strategy folder on the local filesystem (dev/local environments only). It isn't available in this deployment.";

const runScript = (scriptName) =>
  new Promise((resolve) => {
    execFile("python3", [scriptName], { cwd: BACKLINK_DIR, timeout: 60_000 }, (error, stdout, stderr) => {
      // validate_csv.py / duplicate_checker.py exit non-zero on failed checks — that's
      // an expected "report" outcome, not an infra failure, so surface stdout either way.
      resolve({ ok: !error, stdout, stderr, error: error?.message });
    });
  });

const isScriptsAvailable = () => fs.existsSync(SCRIPTS_DIR);

export const validateCsv = async (req, res) => {
  if (!isScriptsAvailable()) return res.status(503).json({ success: false, message: UNAVAILABLE_MESSAGE });
  try {
    const result = await runScript("scripts/validate_csv.py");
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error running validate_csv.py:", error);
    return res.status(500).json({ success: false, message: "Error running validation script" });
  }
};

export const checkDuplicates = async (req, res) => {
  if (!isScriptsAvailable()) return res.status(503).json({ success: false, message: UNAVAILABLE_MESSAGE });
  try {
    const result = await runScript("scripts/duplicate_checker.py");
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error running duplicate_checker.py:", error);
    return res.status(500).json({ success: false, message: "Error running duplicate check script" });
  }
};

export const scoreOpportunities = async (req, res) => {
  if (!isScriptsAvailable()) return res.status(503).json({ success: false, message: UNAVAILABLE_MESSAGE });
  try {
    const result = await runScript("scripts/opportunity_score.py");
    return res.json({ success: true, data: result, message: "Re-run `npm run sync-seo-data` to load updated scores into the database." });
  } catch (error) {
    console.error("Error running opportunity_score.py:", error);
    return res.status(500).json({ success: false, message: "Error running scoring script" });
  }
};

// report_generator.py only supports the monthly cadence — weekly/quarterly stay
// as read-only files under reports/ (see seoReport.controller.js), not generated live.
export const generateMonthlyReport = async (req, res) => {
  if (!isScriptsAvailable()) return res.status(503).json({ success: false, message: UNAVAILABLE_MESSAGE });
  try {
    const result = await runScript("scripts/report_generator.py");
    return res.json({ success: true, data: result, message: "Re-run `npm run sync-seo-data` to register the new report." });
  } catch (error) {
    console.error("Error running report_generator.py:", error);
    return res.status(500).json({ success: false, message: "Error running report generator script" });
  }
};
