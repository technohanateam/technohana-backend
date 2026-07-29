# Redis Configuration Guide

## Local Development Setup

### Option 1: Docker (Recommended)
Redis is easiest to run via Docker. Install Docker Desktop, then:

```bash
docker run -d -p 6379:6379 --name redis-technohana redis:latest
```

Verify it's running:
```bash
docker ps | findstr redis
```

### Option 2: Windows Native Installation
**Download from Microsoft/Redis community:**
1. https://github.com/microsoftarchive/redis/releases
2. Download `Redis-x64-3.0.504.msi` or latest
3. Install and start Redis service

Verify:
```
redis-cli ping
```
Expected output: `PONG`

### Option 3: Windows Subsystem for Linux (WSL)
```bash
wsl
sudo apt-get update
sudo apt-get install redis-server
redis-server
```

## Railway Production Setup

1. **Add Redis to Railway:**
   - Go to Railway dashboard
   - Click "+ Add" → Search "Redis"
   - Select Redis → Deploy

2. **Preferred: use `REDIS_URL`**
   - Railway's Redis plugin exposes a single connection string, usually `REDIS_URL`, on the plugin's Variables tab.
   - Set it on the backend service:
     ```
     REDIS_URL=redis://default:<password>@<host>:<port>
     ```
   - The app (`src/config/redis.js`) checks `REDIS_URL` first and uses it directly if present.

3. **Alternative: discrete host/port/password**
   - If `REDIS_URL` isn't set, the app falls back to:
     ```
     REDIS_HOST=<your-railway-redis-host>
     REDIS_PORT=6379
     REDIS_PASSWORD=<your-password>
     ```
   - Only set these if you're not using `REDIS_URL` — mixing both is unnecessary since `REDIS_URL` takes priority.

## Verify Connection

Once Redis is running, test locally:

```bash
npm run dev
```

Check backend logs — should NOT show Redis connection errors.

## Resend Webhook Configuration

1. **Get Your Railway URL:**
   - Railway Dashboard → Backend Service → Copy domain
   - Example: `https://technohana-backend-production.up.railway.app`

2. **Add Webhook to Resend:**
   - https://resend.com/dashboard/webhooks
   - Click "+ Create webhook"
   - URL: `https://[your-railway-domain]/webhooks/resend`
   - Events: Select all email events:
     - ✅ email.opened
     - ✅ email.clicked
     - ✅ email.bounced
     - ✅ email.complained
     - ✅ email.delivered
     - ✅ email.failed
     - ✅ email.unsubscribed

3. **Test Webhook:**
   - In Resend dashboard, click "Send Test Event"
   - Should see POST request logged in Railway logs

## Troubleshooting

**Error: `Redis connection refused`**
- Ensure Redis is running: `docker ps` or `redis-cli ping`
- Check REDIS_HOST and REDIS_PORT in `.env`

**Error: `WRONGPASS invalid password`**
- Verify `REDIS_PASSWORD` matches Railway Redis password
- Leave empty if no password set (remove line from .env)

**Jobs not processing:**
- Check Redis is accessible: `redis-cli -h <REDIS_HOST> -p 6379 ping`
- Ensure Bull queues are created (first send triggers creation)
