// WhatsApp Cloud API webhook — mounted at /webhooks/whatsapp. Raw body is required
// for the signature check, so index.js skips the global JSON parser for this path.
import express, { Router } from "express";
import { verifyMetaSignature } from "../services/metaLeadAds.js";
import { eventsFrom, applyStatus, recordInbound } from "../services/whatsapp.js";

const router = Router();

router.get("/", (req, res) => {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (req.query["hub.mode"] === "subscribe" && expected && req.query["hub.verify_token"] === expected) {
    return res.status(200).type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
  }
  return res.sendStatus(403);
});

router.post("/", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  if (!verifyMetaSignature(req.body, req.get("x-hub-signature-256"))) return res.sendStatus(401);

  let payload;
  try { payload = JSON.parse(req.body.toString("utf8")); } catch { return res.sendStatus(400); }

  // Acknowledge first — Meta retries slow or non-200 deliveries (handlers are idempotent).
  res.sendStatus(200);
  const { messages, statuses } = eventsFrom(payload);
  for (const s of statuses) applyStatus(s).catch((e) => console.error("[whatsapp] status failed:", e.message));
  for (const m of messages) recordInbound(m).catch((e) => console.error("[whatsapp] inbound failed:", e.message));
});

export default router;
