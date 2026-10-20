import crypto from "crypto";
import jwt from "jsonwebtoken";
import CrmLinkedinConnection from "../models/crm/crmLinkedinConnection.model.js";
import {
  buildConsentUrl, exchangeCodeForTokens, tokenFields, getLinkedinScopes, isLinkedinConfigured,
  LinkedinNotConfiguredError, LinkedinAuthError,
} from "../config/linkedinClient.js";
import { listAdAccounts } from "../services/linkedinService.js";
import { isValidId, sendCrmError } from "../utils/crmQuery.js";

const crmAppUrl = () => process.env.CRM_FRONTEND_URL || "/";
const redirectToApp = (res, query) => res.redirect(`${crmAppUrl()}/integrations?${query}`);

export const getLinkedinStatus = async (req, res) => {
  try {
    const conn = await CrmLinkedinConnection.findOne({ key: "default" }).select("-encryptedTokens").lean();
    res.json({
      success: true,
      data: {
        configured: isLinkedinConfigured(),
        connected: Boolean(conn?.isActive),
        needsReconnect: Boolean(conn && !conn.isActive),
        accountSelected: Boolean(conn?.isActive && conn.adAccountUrn),
        adAccountName: conn?.adAccountName,
        adAccountUrn: conn?.adAccountUrn,
        currency: conn?.currency,
        connectedAt: conn?.connectedAt,
        refreshTokenExpiresAt: conn?.refreshTokenExpiresAt,
        lastSyncAt: conn?.lastLeadSyncAt,
        lastSyncStatus: conn?.lastSyncStatus,
        lastSyncError: conn?.lastSyncError,
      },
    });
  } catch (err) {
    sendCrmError(res, err, "Failed to load LinkedIn status");
  }
};

export const getLinkedinConnectUrl = async (req, res) => {
  try {
    const state = jwt.sign(
      { uid: String(req.admin._id), nonce: crypto.randomBytes(8).toString("hex"), purpose: "linkedin-connect" },
      process.env.CRM_JWT_SECRET,
      { expiresIn: "10m" }
    );
    res.json({ success: true, data: { url: buildConsentUrl(state) } });
  } catch (err) {
    if (err instanceof LinkedinNotConfiguredError) {
      return res.status(503).json({ success: false, message: "LinkedIn isn't configured on the server yet." });
    }
    sendCrmError(res, err, "Failed to start LinkedIn connection");
  }
};

// Public — LinkedIn redirects the browser here, so there is no Bearer token; `state` is the proof.
export const handleLinkedinCallback = async (req, res) => {
  try {
    const { code, state, error: liError } = req.query;
    if (liError) return redirectToApp(res, "linkedin=denied");
    if (!code || !state) return redirectToApp(res, "linkedin=error&reason=missing_params");

    let payload;
    try {
      payload = jwt.verify(String(state), process.env.CRM_JWT_SECRET);
    } catch (e) {
      return redirectToApp(res, `linkedin=error&reason=${e.name === "TokenExpiredError" ? "state_expired" : "state_invalid"}`);
    }
    if (payload.purpose !== "linkedin-connect" || !isValidId(payload.uid)) return redirectToApp(res, "linkedin=error&reason=state_invalid");

    const tokens = await exchangeCodeForTokens(String(code));
    // Reconnecting keeps the chosen ad account and sync cursor, so no leads are skipped.
    await CrmLinkedinConnection.findOneAndUpdate(
      { key: "default" },
      {
        $set: {
          ...tokenFields(tokens),
          scopes: getLinkedinScopes(),
          isActive: true,
          connectedBy: payload.uid,
          connectedAt: new Date(),
          lastSyncStatus: "never",
          lastSyncError: undefined,
        },
      },
      { upsert: true, new: true }
    );
    redirectToApp(res, "linkedin=connected");
  } catch (err) {
    console.error("LinkedIn OAuth callback failed:", err.message);
    redirectToApp(res, "linkedin=error&reason=unknown");
  }
};

export const getLinkedinAdAccounts = async (req, res) => {
  try {
    const conn = await CrmLinkedinConnection.findOne({ key: "default", isActive: true });
    if (!conn) return res.status(409).json({ success: false, message: "Connect LinkedIn first." });
    res.json({ success: true, data: await listAdAccounts(conn) });
  } catch (err) {
    if (err instanceof LinkedinAuthError) {
      return res.status(409).json({ success: false, message: "LinkedIn connection expired — reconnect it." });
    }
    if (err.status === 403) {
      return res.status(502).json({ success: false, message: "LinkedIn denied access to ad accounts. Check the app's Marketing Developer Platform approval." });
    }
    if (err.status) {
      console.error("[linkedin] ad accounts failed:", err.status, err.message);
      return res.status(502).json({ success: false, message: `LinkedIn returned ${err.status}: ${err.message}` });
    }
    sendCrmError(res, err, "Failed to load LinkedIn ad accounts");
  }
};

export const selectLinkedinAdAccount = async (req, res) => {
  try {
    const { adAccountUrn } = req.body;
    if (typeof adAccountUrn !== "string" || !/^urn:li:sponsoredAccount:\d+$/.test(adAccountUrn)) {
      return res.status(400).json({ success: false, message: "Pick a valid ad account" });
    }
    const conn = await CrmLinkedinConnection.findOne({ key: "default", isActive: true });
    if (!conn) return res.status(409).json({ success: false, message: "Connect LinkedIn first." });

    const account = (await listAdAccounts(conn)).find((a) => a.urn === adAccountUrn);
    if (!account) return res.status(404).json({ success: false, message: "That ad account isn't available to this connection" });

    // Switching accounts resets the cursor so the new account's recent leads are imported.
    const changed = conn.adAccountUrn !== adAccountUrn;
    conn.adAccountUrn = account.urn;
    conn.adAccountName = account.name;
    conn.currency = account.currency;
    if (changed) conn.lastLeadSyncAt = undefined;
    await conn.save();
    res.json({ success: true, message: "Ad account saved" });
  } catch (err) {
    if (err instanceof LinkedinAuthError) {
      return res.status(409).json({ success: false, message: "LinkedIn connection expired — reconnect it." });
    }
    sendCrmError(res, err, "Failed to save ad account");
  }
};

export const disconnectLinkedin = async (req, res) => {
  try {
    await CrmLinkedinConnection.deleteOne({ key: "default" });
    res.json({ success: true, message: "LinkedIn disconnected" });
  } catch (err) {
    sendCrmError(res, err, "Failed to disconnect LinkedIn");
  }
};
