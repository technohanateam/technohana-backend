# CLAUDE.md — technohana-backend

## Stack
- Node.js ES modules (`"type": "module"` — use `import/export`, never `require()`)
- Express 4 · MongoDB/Mongoose · Redis/Bull queues
- AI: Anthropic SDK + OpenAI SDK
- Payments: Stripe (international) + Razorpay (India/INR)
- Email: Resend
- Deployed: Railway

## Dev Commands
```bash
npm run start              # node src/index.js (production)
npm run sync-prices        # copy courses.json from frontend, update price catalog
node seed-coupons.js       # seed festival coupons to MongoDB
node seed-courses.js       # seed course catalog
```

## Architecture Rules

### ES Modules — Critical
- Import paths **must** include `.js` extension: `import X from './utils/helper.js'`
- Never use `require()` anywhere in `src/` — this is an ES module project
- Named exports for controllers; default export for route files and Mongoose models

### Pricing Engine — Read Before Touching Payment Code
Lives in `src/index.js` → `computeQuote()` (~line 150) and `getDiscountRate()` (~line 166).

Discount chain (exact order, compounding):
1. Enrollment type → Individual=0%, Group 2-4=15%, Group 5-9=25%, Group 10+=35%
2. Coupon → applied to post-enrollment price (query MongoDB, never hardcode)
3. Referral → applied to post-coupon price (capped at 50% total)

The backend **never** trusts client-supplied prices. `POST /pricing/quote` and all Stripe/Razorpay order creation endpoints must call `computeQuote()` server-side.

If changing discount percentages, update **both**:
- `src/index.js` → `getDiscountRate()`
- `COUPON_CODES_REFERENCE.md`

### File Structure & Naming
```
src/
  index.js            ← Express app + pricing engine + payment routes
  controllers/        ← [domain].controller.js — named exports
  models/             ← [name].model.js — default export (mongoose.model)
  routes/             ← [domain].routes.js
  services/           ← Bull queues, email, campaign logic
  middleware/         ← authenticateJWT.js, authenticateAdmin.js, upload.js
  config/             ← db.js, passport.js, emailService.js, jwt.js
  utils/              ← emailTemplate.js, segmentationEngine.js
```

### Auth
- User routes: `authenticateJWT` middleware (`src/middleware/authenticateJWT.js`)
- Admin routes: `authenticateAdmin` middleware (`src/middleware/authenticateAdmin.js`)
- Public routes (intentional): pricing/quote, coupon validate, enrollment form submission
- Never skip `authenticateAdmin` on any admin route

### MongoDB
- Connection: `src/config/db.js` via MONGO_URI env var
- User model is dual-purpose: auth users AND enrollment records
- Sparse indexes on optional unique fields — do not remove `sparse: true` from googleId, referralCode, enrollmentToken, orderId

### Email
- All email via `sendEmail()` in `src/config/emailService.js` using Resend
- Templates in `src/utils/emailTemplate.js`
- Admin notifications to `process.env.MAIL_TO` — never hardcode addresses

### Response Format
```js
// Success
res.json({ success: true, data: ..., message: '...' })
// Error
res.status(4xx).json({ success: false, message: '...' })
```
Never leak stack traces or internal error details in production responses.

### Don'ts
- Don't use `require()` anywhere in `src/`
- Don't trust client-supplied price values
- Don't hardcode coupon codes — query MongoDB
- Don't commit `.env` files
- Don't read `node_modules`
- Don't skip `authenticateAdmin` on any admin route
- Don't add `.js` extension to relative imports? Wrong — the `.js` extension IS required for ES modules

## Key File Paths
| Purpose | Path |
|---------|------|
| App entry + pricing engine | `src/index.js` |
| computeQuote() | `src/index.js` ~line 150 |
| getDiscountRate() | `src/index.js` ~line 166 |
| Enrollment controller | `src/controllers/enrollment.controller.js` |
| Coupon controller | `src/controllers/coupon.controller.js` |
| Referral controller | `src/controllers/referral.controller.js` |
| User model (dual-use) | `src/models/user.model.js` |
| Coupon model | `src/models/coupon.model.js` |
| Order model | `src/models/order.model.js` |
| JWT helpers | `src/config/jwt.js` |
| Email sender | `src/config/emailService.js` |
| Email templates | `src/utils/emailTemplate.js` |
| Campaign queue | `src/services/campaignQueue.js` |
| Campaign triggers | `src/services/campaignEventTrigger.js` |
| Shared Claude client (AI agents) | `src/services/aiAgent.service.js` |
| Recovery email agent | `src/services/recoveryEmailAgent.js` |
| Lead scoring agent | `src/services/leadScoringAgent.js` |

## Environment Variables (never commit)
```
MONGO_URI=
JWT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
STRIPE_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RESEND_API_KEY=
ANTHROPIC_API_KEY=
MAIL_TO=
FRONTEND_URL=
WHITELISTED_URLS=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
REDIS_URL=
```

## Reference Docs
- `AI_AGENTS_ROADMAP.md` — AI agent roadmap + implemented agents (lead scoring, recovery emails)
- `COUPON_CODES_REFERENCE.md` — festival coupon calendar + discount logic
- `CAMPAIGN_E2E_TESTING.md` — end-to-end test scenarios
- `CAMPAIGN_DEPLOYMENT_CHECKLIST.md` — pre-deploy checklist
- `REDIS_SETUP.md` — Bull queue / Redis configuration
