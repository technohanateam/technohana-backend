// Meta webhook (Lead Ads + Instagram comments) — mounted at /webhooks/meta-leads. The global JSON
// parser skips this path (index.js) because the signature covers the raw bytes.
import express, { Router } from "express";
import { verifyMetaSignature, leadgenEventsFrom, processMetaLeadgen } from "../services/metaLeadAds.js";
import { commentEventsFrom, handleInstagramComment } from "../services/instagramComments.js";

const router = Router();
const QUEUE_TIMEOUT_MS = 5000;

// Subscription handshake: Meta calls GET with hub.* params and expects the challenge back.
router.get("/", (req, res) => {
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (req.query["hub.mode"] === "subscribe" && expected && req.query["hub.verify_token"] === expected) {
    return res.status(200).type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
  }
  return res.sendStatus(403);
});

// Queue each lead for the worker; if Redis can't take it promptly, process it
// here instead so the lead isn't lost (processing is idempotent either way).
const dispatch = async (event) => {
  try {
    const { enqueueMetaLeadgen } = await import("../services/metaLeadQueue.js");
    await Promise.race([
      enqueueMetaLeadgen(event),
      new Promise((_, reject) => setTimeout(() => reject(new Error("queue timeout")), QUEUE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn(`[meta-leads] queue unavailable (${err.message}) — processing leadgen ${event.leadgenId} inline`);
    await processMetaLeadgen(event).catch((e) => console.error(`[meta-leads] leadgen ${event.leadgenId} failed:`, e.message));
  }
};

router.post("/", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  if (!verifyMetaSignature(req.body, req.get("x-hub-signature-256"))) return res.sendStatus(401);

  let payload;
  try { payload = JSON.parse(req.body.toString("utf8")); } catch { return res.sendStatus(400); }

  // Acknowledge first — Meta retries deliveries that are slow or non-200.
  res.sendStatus(200);
  for (const event of leadgenEventsFrom(payload)) dispatch(event);
  for (const event of commentEventsFrom(payload)) {
    handleInstagramComment(event).catch((e) => console.error(`[instagram] comment ${event.commentId} failed:`, e.message));
  }
});

export default router;
