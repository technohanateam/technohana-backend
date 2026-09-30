# Resend Webhook Setup Guide

## Prerequisites
- ✅ Backend deployed to Railway (or public URL)
- ✅ `/webhooks/resend` endpoint available on backend
- ✅ Resend account with API access

## Step-by-Step Setup

### 1. Get Your Backend URL

**From Railway Dashboard:**
1. Go to https://railway.app/dashboard
2. Select "Technohana Backend" project
3. Click "Services" → "Backend"
4. Copy the public domain (e.g., `https://technohana-backend-production.up.railway.app`)

### 2. Add Webhook in Resend

1. Go to https://resend.com/dashboard
2. Click "Webhooks" in left sidebar
3. Click "+ Create webhook"

### 3. Configure Webhook Details

**Webhook URL:**
```
https://[your-railway-domain]/webhooks/resend
```

Example:
```
https://technohana-backend-production.up.railway.app/webhooks/resend
```

**Select Events to Subscribe:**
- ✅ email.opened — when recipient opens email
- ✅ email.clicked — when recipient clicks link in email
- ✅ email.bounced — when email bounces (invalid address)
- ✅ email.complained — when recipient marks as spam
- ✅ email.delivered — when email successfully delivered
- ✅ email.failed — when email fails to send
- ✅ email.unsubscribed — when recipient unsubscribes

**Important:** Check at least the above 7 events. Don't leave any unchecked unless specific.

### 4. Save Webhook

Click "Create" — Resend will show:
- Webhook URL (confirm matches your domain)
- Signing secret (if using HMAC validation)
- Status: "Active" ✅

## Verify Webhook Works

### Option A: Send Test Event

1. In Resend dashboard, find your webhook
2. Click "Send test event"
3. Check Railway backend logs:

```
[Webhook] Received Resend event
Processing email.opened event
Updating campaign metrics
```

If no logs appear:
- Check URL is correct (no typos)
- Verify backend is running
- Check firewall isn't blocking Railway domain

### Option B: Real Campaign Send

1. Create campaign in admin panel
2. Send to test recipient
3. Open email
4. Check campaign metrics update within 30 seconds

Admin Panel:
- Go to `/admin/campaigns`
- Select your campaign
- Click "Analytics"
- Verify metrics: `opened: 1`

## Troubleshooting

### ❌ Webhook Not Connecting

**Check 1: URL is Public**
```bash
# From your terminal
curl https://[your-domain]/webhooks/resend
# Should return 405 (Method Not Allowed) since it only accepts POST
```

**Check 2: Resend Dashboard Status**
- Go to https://resend.com/dashboard/webhooks
- Ensure webhook shows "Active" (green)
- Check "Last event" timestamp

**Check 3: Firewall/CORS**
- Railway shouldn't have CORS issues for webhook
- If behind corporate firewall, whitelist:
  - `api.resend.com`
  - `your-railway-domain`

### ❌ Events Not Updating Metrics

**Check Railways Logs:**
```
GET: https://railway.app/dashboard → Backend → Logs
Filter for: "Webhook" or "email.opened"
```

**Expected log pattern:**
```
[Resend Webhook] POST /webhooks/resend
Processing event: email.opened
Campaign ID found: xxx
Recipient updated: {email, openedAt}
Campaign metrics saved
```

### ❌ "Campaign not found" Error

**Cause:** Email doesn't have Campaign ID header

**Fix:** 
- Ensure campaigns are sent via `POST /admin/campaigns/{id}/send`
- Campaign sends via Bull queue include Campaign ID in headers
- Check Resend email headers include: `X-Campaign-ID`

## Testing Checklist

- [✅] Webhook URL is public (no localhost)
- [✅] Webhook URL matches Railway domain exactly
- [✅] All 7 events selected in Resend
- [✅] Webhook status is "Active" in Resend
- [✅] Test event payload received in backend
- [✅] Campaign metrics updated after test
- [✅] Real email opens trigger webhook
- [✅] Metrics visible in `/admin/campaigns/{id}/analytics`

## Webhook Signature Validation (Required)

`resendWebhook.js` verifies every incoming event via svix and **hard-rejects
the request if this isn't set up** — it's not optional.

1. Get signing secret from Resend:
   - Resend Dashboard → Webhooks → Your webhook → Copy signing secret

2. Store it as `RESEND_WEBHOOK_SECRET` in Railway's environment variables
   (never commit it to `.env`).

3. `resendWebhook.js` uses it via the `svix` package:
   ```javascript
   const wh = new Webhook(secret);
   const event = wh.verify(req.body, {
     "svix-id": req.headers["svix-id"],
     "svix-timestamp": req.headers["svix-timestamp"],
     "svix-signature": req.headers["svix-signature"],
   });
   ```
   This requires `req.body` to be the raw request body (a Buffer/string),
   not JSON-parsed — `src/index.js` exempts `/webhooks/resend` from the
   global `express.json()` middleware for this reason.

Without `RESEND_WEBHOOK_SECRET` set, every event is rejected with HTTP 500
before verification is even attempted, and campaign analytics (opens,
clicks, bounces) will never update.

## Production Deployment Checklist

- [✅] Backend deployed to Railway
- [✅] RESEND_API_KEY set in Railway env vars
- [✅] REDIS_HOST, REDIS_PORT, REDIS_PASSWORD configured
- [✅] Webhook URL added in Resend dashboard
- [✅] All 7 event types selected
- [✅] First test campaign created and sent
- [✅] Metrics verified in admin analytics
- [✅] Webhook receiving real events
