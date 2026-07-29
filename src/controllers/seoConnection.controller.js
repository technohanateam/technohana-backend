import crypto from "crypto";
import jwt from "jsonwebtoken";
import SeoConnection from "../models/seoConnection.model.js";
import {
  buildConsentUrl,
  exchangeCodeForTokens,
  encryptRefreshToken,
  decryptRefreshToken,
  createOAuthClient,
  getAuthedClientForConnection,
  SeoGoogleNotConfiguredError,
} from "../config/googleSeoOAuth.js";
import { listVerifiedSites } from "../services/gscSyncService.js";
import { getGa4DataClient } from "../config/googleGa4Data.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

export const listConnections = async (req, res) => {
  try {
    const connections = await SeoConnection.find().select("-encryptedRefreshToken").sort({ connectedAt: -1 });
    return res.json({ success: true, data: connections });
  } catch (error) {
    console.error("Error listing SEO connections:", error);
    return res.status(500).json({ success: false, message: "Error listing connections" });
  }
};

// The consent URL is provider-agnostic (both scopes requested together) —
// `provider` in the route just labels which flow initiated the request.
export const getConnectUrl = async (req, res) => {
  try {
    const { provider } = req.params;
    if (!["gsc", "ga4"].includes(provider)) {
      return res.status(400).json({ success: false, message: "Invalid provider" });
    }
    const state = jwt.sign({ adminId: req.admin?.uid, provider, nonce: crypto.randomBytes(8).toString("hex") }, process.env.ADMIN_JWT_SECRET, {
      expiresIn: "10m",
    });
    const url = buildConsentUrl(state);
    return res.json({ success: true, data: { url } });
  } catch (error) {
    if (error instanceof SeoGoogleNotConfiguredError) {
      return res.status(503).json({ success: false, message: "Google OAuth is not configured yet." });
    }
    console.error("Error building SEO OAuth consent URL:", error);
    return res.status(500).json({ success: false, message: "Error building consent URL" });
  }
};

// Public route (hit via top-level browser redirect from Google) — validates
// `state` itself instead of relying on authenticateAdmin.
export const handleOAuthCallback = async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "/";
  try {
    const { code, state } = req.query;
    if (!code || !state) throw new Error("Missing code/state");

    const payload = jwt.verify(state, process.env.ADMIN_JWT_SECRET);
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      throw new Error("Google did not return a refresh token — retry with prompt=consent");
    }

    // Build a scoped client for this one exchange rather than mutating the
    // shared singleton (getSeoOAuthClient()) — that instance is reused by
    // concurrent connect/callback requests, so setting credentials on it
    // would leak tokens between requests racing each other.
    const client = createOAuthClient();
    client.setCredentials(tokens);

    const sites = await listVerifiedSites(client);
    const encryptedRefreshToken = encryptRefreshToken(tokens.refresh_token);

    for (const site of sites) {
      await SeoConnection.findOneAndUpdate(
        { provider: "gsc", propertyId: site.siteUrl },
        {
          $set: {
            propertyLabel: site.siteUrl,
            encryptedRefreshToken,
            scopes: (tokens.scope || "").split(" "),
            connectedByAdminId: payload.adminId,
            connectedAt: new Date(),
            isActive: true,
          },
        },
        { upsert: true }
      );
    }

    // If the requested flow was GA4, the admin still needs to pick/enter a
    // property ID since GA4 has no "list my properties" call available with
    // analytics.readonly scope alone — store a pending connection stub.
    // Keyed per-flow on the state's nonce (not a shared literal like
    // "pending") so two GA4 connect flows in flight at once each get their
    // own stub instead of the second callback overwriting the first flow's
    // stored refresh token.
    if (payload.provider === "ga4") {
      await SeoConnection.findOneAndUpdate(
        { provider: "ga4", propertyId: `pending-${payload.nonce}` },
        {
          $set: {
            propertyLabel: "Pending property selection",
            encryptedRefreshToken,
            scopes: (tokens.scope || "").split(" "),
            connectedByAdminId: payload.adminId,
            connectedAt: new Date(),
            isActive: false,
            pendingSelection: true,
          },
        },
        { upsert: true }
      );
    }

    return res.redirect(`${frontendUrl}/admin/seo-intel/search-console?connected=1`);
  } catch (error) {
    console.error("Error handling SEO OAuth callback:", error);
    return res.redirect(`${frontendUrl}/admin/seo-intel/search-console?connected=0`);
  }
};

export const setGa4PropertyId = async (req, res) => {
  try {
    const { id } = req.params;
    const { propertyId } = req.body;
    if (!propertyId) return res.status(400).json({ success: false, message: "propertyId is required" });

    const connection = await SeoConnection.findById(id);
    if (!connection || connection.provider !== "ga4") {
      return res.status(404).json({ success: false, message: "GA4 connection not found" });
    }

    // Verify the property is reachable with the stored credentials before activating.
    const client = await getAuthedClientForConnection(connection);
    const analyticsdata = getGa4DataClient(client);
    await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: { dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], dimensions: [], metrics: [{ name: "sessions" }] },
    });

    connection.propertyId = propertyId;
    connection.propertyLabel = `properties/${propertyId}`;
    connection.isActive = true;
    connection.pendingSelection = false;
    await connection.save();

    await logSeoAudit(req, "ga4.connect", "SeoConnection", connection._id.toString(), { propertyId });
    return res.json({ success: true, data: connection });
  } catch (error) {
    console.error("Error setting GA4 property:", error);
    return res.status(400).json({ success: false, message: "Could not verify GA4 property access" });
  }
};

export const disconnect = async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await SeoConnection.findById(id);
    if (!connection) return res.status(404).json({ success: false, message: "Connection not found" });

    try {
      // revokeCredentials() revokes credentials.access_token, but stored
      // connections only ever carry a refresh_token — call revokeToken()
      // directly with it instead (Google's revoke endpoint accepts either).
      const client = createOAuthClient();
      await client.revokeToken(decryptRefreshToken(connection));
    } catch (revokeErr) {
      console.warn("[SeoConnection] token revoke failed (continuing):", revokeErr.message);
    }

    await SeoConnection.findByIdAndDelete(id);
    await logSeoAudit(req, `${connection.provider}.disconnect`, "SeoConnection", id, { propertyId: connection.propertyId });
    return res.json({ success: true, message: "Disconnected" });
  } catch (error) {
    console.error("Error disconnecting SEO connection:", error);
    return res.status(500).json({ success: false, message: "Error disconnecting" });
  }
};
