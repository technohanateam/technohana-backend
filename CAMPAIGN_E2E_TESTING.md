# Campaign Automation E2E Testing Guide

## Prerequisites
- ✅ Redis running locally (or Railway Redis configured)
- ✅ Backend started: `npm run dev`
- ✅ Admin user logged in
- ✅ Resend webhook configured (optional for local testing)

## Test Scenario 1: Create & Send Campaign

### Step 1: Start Backend
```bash
cd technohana-backend-master
npm install  # Ensure all dependencies including bull are installed
npm run dev
```

Check logs for:
- ✅ "Server is running on port 3000"
- ✅ "campaignQueue ready" (if added from logger)
- ❌ NO "Redis connection failed" errors

### Step 2: Create Test Campaign via API

Using Postman/REST Client:

**POST** `http://localhost:5000/admin/campaigns`

Headers:
```
Content-Type: application/json
Authorization: Bearer <your-admin-jwt>
```

Body:
```json
{
  "name": "Test Welcome Campaign",
  "description": "Test campaign for enrolled users",
  "subject": "Welcome to Technohana!",
  "htmlContent": "<h1>Welcome!</h1><p>Thank you for enrolling. Access your course here.</p><a href='https://www.technohana.in'>Start Learning</a>",
  "previewText": "Welcome to your course",
  "segments": {
    "enrolled": true
  },
  "triggerType": "schedule"
}
```

Response should be:
```json
{
  "success": true,
  "data": {
    "_id": "...campaign-id...",
    "name": "Test Welcome Campaign",
    "status": "draft"
  }
}
```

### Step 3: Check Segment Size (Preview)

**POST** `http://localhost:5000/admin/campaigns/estimate-segment`

Headers:
```json
{
  "segments": { "enrolled": true }
}
```

Response:
```json
{
  "success": true,
  "estimatedSize": 5,
  "preview": [
    { "email": "user@example.com", "name": "John Doe" },
    ...
  ]
}
```

### Step 4: Send Campaign Now

**POST** `http://localhost:5000/admin/campaigns/{campaign-id}/send`

Response:
```json
{
  "success": true,
  "message": "Campaign queued for sending to ~5 recipients",
  "data": { ... },
  "jobId": "123"  // Bull job ID
}
```

### Step 5: Check Queue Status

**GET** `http://localhost:5000/admin/campaigns/queue/stats`

Response:
```json
{
  "success": true,
  "data": {
    "campaigns": {
      "pending": 1,
      "active": 0,
      "completed": 0,
      "failed": 0
    },
    "events": {
      "pending": 0,
      "active": 0,
      "completed": 0,
      "failed": 0
    }
  }
}
```

Wait a few seconds, then refresh — should see:
- `active: 1` (job is processing)
- Then `completed: 1` (job finished)

### Step 6: Verify Campaign Status

**GET** `http://localhost:5000/admin/campaigns/{campaign-id}`

Should show:
```json
{
  "success": true,
  "data": {
    "status": "scheduled",  // Changed from draft
    "metrics": {
      "totalSent": 5,
      "delivered": 5,
      "opened": 0,
      "clicked": 0,
      "bounced": 0
    },
    "sentAt": "2026-03-06T..."
  }
}
```

### Step 7: Verify Emails in Resend (Optional)

1. Go to https://resend.com/dashboard/logs
2. Filter by campaign date/time
3. Should see emails:
   - Status: "Sent" ✅
   - Recipients: The segment users
   - Subject: "Welcome to Technohana!"

## Test Scenario 2: Event-Triggered Campaign

### Step 1: Create Event-Triggered Campaign

**POST** `http://localhost:5000/admin/campaigns`

```json
{
  "name": "Payment Confirmation",
  "subject": "Payment Received - Technohana",
  "htmlContent": "<h1>Payment Success!</h1><p>Your course access is ready.</p>",
  "segments": { "enrolled": true },
  "triggerType": "event",
  "eventTrigger": {
    "event": "PAYMENT_RECEIVED",
    "delayMinutes": 0
  }
}
```

### Step 2: Process a Test Payment

Create a test order and complete payment:
1. Go to http://localhost:5173/enrollment/{courseId}
2. Use test payment (not real money)
3. Verify payment in `/payments/verify`

### Step 3: Watch Event Processing

**GET** `http://localhost:5000/admin/campaigns/queue/stats`

You should see:
```json
{
  "events": {
    "pending": 1,  // Event-triggered job queued
    "active": 0,
    "completed": 0
  }
}
```

Wait a few seconds:
```json
{
  "events": {
    "completed": 1  // Job processed
  }
}
```

### Step 4: Verify Campaign Metrics

**GET** `http://localhost:5000/admin/campaigns/{campaign-id}/analytics`

Should show:
```json
{
  "success": true,
  "data": {
    "campaign": {
      "name": "Payment Confirmation",
      "status": "running",
      "sentAt": "2026-03-06T..."
    },
    "metrics": {
      "totalSent": 1,
      "delivered": 1,
      "openRate": "0.00",
      "clickRate": "0.00"
    }
  }
}
```

## Test Scenario 3: Webhook Event Tracking (Production Only)

**Requirements:**
- Resend webhook configured (see REDIS_SETUP.md)
- Campaign sent to real emails
- Wait 2-5 minutes for email delivery

### Step 1: Open Email

Open the test email in your inbox.

### Step 2: Check Webhook Event

Backend should log:
```
[Webhook] Processing email.opened event
Updating campaign metrics: opened count++
```

### Step 3: Verify Metrics Updated

**GET** `http://localhost:5000/admin/campaigns/{campaign-id}/analytics`

After email opened:
```json
{
  "metrics": {
    "totalSent": 1,
    "opened": 1,
    "openRate": "100.00"
  }
}
```

## Common Issues & Fixes

### ❌ Error: "ECONNREFUSED 127.0.0.1:6379"
**Cause:** Redis not running
**Fix:** Start Redis (see REDIS_SETUP.md)

### ❌ Error: "Campaign not found in queue"
**Cause:** Campaign ID malformed or doesn't exist
**Fix:** Verify campaign exists: `GET /admin/campaigns`

### ❌ Emails not sending
**Cause:** RESEND_API_KEY invalid
**Fix:** Verify in `.env`: `npm run dev | grep RESEND`

### ❌ Queue stats shows pending=0, completed=0
**Cause:** Jobs not being processed
**Fix:** 
1. Ensure Redis is connected
2. Restart backend: `npm run dev`
3. Check logs for Bull queue errors

### ❌ Webhook not receiving events
**Cause:** Resend not configured, or privacy firewall blocking
**Fix:**
1. Use https:// URL (not localhost)
2. Deploy to Railway
3. Add webhook in Resend dashboard
4. Send test event from Resend

## Success Checklist

- [✅] Redis running and connected
- [✅] Campaign created and status is "draft"
- [✅] Segment preview shows users
- [✅] Campaign sent and status changes to "scheduled"
- [✅] Queue stats show job completion
- [✅] Campaign metrics updated (totalSent > 0)
- [✅] For production: Resend shows emails as "Sent"
- [✅] For production: Webhook events tracked in metrics
