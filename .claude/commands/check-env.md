Audit environment variable usage in technohana-backend.

$ARGUMENTS

Required env vars and where each is used:
- `MONGO_URI` → `src/config/db.js`
- `JWT_SECRET` → `src/config/jwt.js`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` → `src/config/passport.js`
- `STRIPE_SECRET` → `src/index.js` (Stripe initialization)
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` → `src/index.js` (Razorpay initialization)
- `RESEND_API_KEY` → `src/config/emailService.js`
- `MAIL_TO` → admin notification email in controllers
- `FRONTEND_URL`, `WHITELISTED_URLS` → CORS config in `src/index.js`
- `REDIS_URL` → `src/services/campaignQueue.js`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` → upload/cloudinary config

Check:
1. Any `process.env.X` where X is not in the list above — flag and explain what it's used for
2. Any hardcoded fallback values like `process.env.JWT_SECRET || 'hardcoded-secret'` — these are security risks, report as CRITICAL
3. Any `.env` file paths referenced in code rather than via dotenv at startup
4. Confirm all required vars have Railway environment entries (check `railway.json` for clues)
