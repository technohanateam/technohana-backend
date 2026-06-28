# CLAUDE.md — technohana-backend

## Stack
- Node.js ES modules (`"type": "module"` — use `import/export`, never `require()`)
- Express 4 · MongoDB/Mongoose · Redis/Bull queues
- AI: Anthropic SDK (`@anthropic-ai/sdk`) + OpenAI SDK
- Payments: Stripe (international) + Razorpay (India/INR)
- Email: Resend · File uploads: Cloudinary + Multer
- Deployed: Railway

## Dev Commands
```bash
npm run start              # node src/index.js (production)
npm run sync-prices        # copy courses.json from frontend, update price catalog
npm run seed               # seed blog posts (node src/blogSeed.js)
npm run reseed             # reseed full course catalog (node seed-courses.js)
node seed-coupons.js       # seed festival coupons to MongoDB
node seed-courses.js       # seed course catalog
```

## Architecture Rules

### ES Modules — Critical
- Import paths **must** include `.js` extension: `import X from './utils/helper.js'`
- Never use `require()` anywhere in `src/` — this is an ES module project
- Named exports for controllers; default export for route files and Mongoose models

### Pricing Engine — Read Before Touching Payment Code
Lives in `src/utils/pricing.js` → `computeQuote()` and `getBasePriceMinor()`.

Discount chain (exact order, compounding):
1. Enrollment type → Individual=0%, Group 2-4=15%, Group 5-9=25%, Group 10+=35%
2. Coupon → applied to post-enrollment price (validated against MongoDB + in-memory map)
3. Referral → applied to post-coupon price (capped at 50% total)

Admin override: `applyManualDiscount(quote, pct)` — 0-25%, also capped at 50% floor.

The backend **never** trusts client-supplied prices. `POST /pricing/quote` and all Stripe/Razorpay order creation endpoints must call `computeQuote()` server-side.

Coupons are stored in MongoDB (`coupon.model.js`) AND mirrored in a `validCoupons` map in `src/utils/pricing.js`. If you add/change coupon codes, update **both**:
- `src/utils/pricing.js` → `validCoupons` map
- `COUPON_CODES_REFERENCE.md`

### File Structure & Naming
```
src/
  index.js              ← Express app entry + payment routes (Stripe/Razorpay) + route mounting
  utils/
    pricing.js          ← computeQuote(), getBasePriceMinor(), applyManualDiscount()
    emailTemplate.js    ← HTML email templates
    segmentationEngine.js ← Campaign audience segmentation
  controllers/          ← [domain].controller.js — named exports
  models/               ← [name].model.js — default export (mongoose.model)
  routes/               ← [domain].routes.js
  services/             ← Bull queues, AI agents, email webhooks
  middleware/           ← authenticateJWT.js, authenticateAdmin.js, authenticateInstructor.js, upload.js
  config/               ← db.js, passport.js, emailService.js, jwt.js, cloudinary.js
  constants/            ← adminPages.js (role-based page access list)
  data/                 ← courses.json (synced from frontend via npm run sync-prices)
```

### Auth — Three Separate Middleware Files
| Middleware | File | Used For |
|-----------|------|---------|
| `authenticateJWT` | `src/middleware/authenticateJWT.js` | Regular user routes |
| `authenticateAdmin` | `src/middleware/authenticateAdmin.js` | Admin/sales/marketing routes |
| `authenticateInstructor` | `src/middleware/authenticateInstructor.js` | Instructor portal routes |

`authenticateAdmin` has role helpers:
- `requireAdmin()` — blocks sales/marketing from destructive ops
- `requireMarketing()` — allows marketing team
- `requirePage("page_name")` — page-level access control

Public routes (intentional, no auth): `/pricing/quote`, `/api/coupons/validate`, `/api/coupons/public`, `/enroll`, `/enquiry`, `/contact-us`

**Never skip `authenticateAdmin` on any `/admin/*` route.**

### Admin Role System
Three roles stored in `adminUser.model.js`: `admin`, `sales`, `marketing`
Each user has a `pages` array for page-level granular access (e.g. `['team', 'coupons', 'campaigns']`).
Page names are defined in `src/constants/adminPages.js`.

### MongoDB
- Connection: `src/config/db.js` via `MONGO_URI` env var
- User model is dual-purpose: auth users AND enrollment records
- Sparse indexes on optional unique fields — **do not remove `sparse: true`** from `googleId`, `referralCode`, `enrollmentToken`, `orderId`
- PendingOrder is an in-memory Mongoose model with 24h TTL — defined inline in `src/index.js`

### Email
- All email via `sendEmail()` in `src/config/emailService.js` using Resend
- Templates in `src/utils/emailTemplate.js`
- Admin notifications to `process.env.MAIL_TO` — never hardcode addresses
- Bounce/complaint handling: `src/services/resendWebhook.js` at `POST /webhooks/resend`

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
- Don't trust client-supplied price values — always call `computeQuote()` server-side
- Don't hardcode coupon codes — query MongoDB (or reference `validCoupons` map in pricing.js)
- Don't commit `.env` files
- Don't read `node_modules`
- Don't skip `authenticateAdmin` on any admin route
- The `.js` extension IS required for all relative imports in ES modules
- Don't add inline payment or pricing logic in route files — use `computeQuote()` from pricing.js

## Key File Paths
| Purpose | Path |
|---------|------|
| App entry + payment routes | `src/index.js` |
| Pricing engine | `src/utils/pricing.js` |
| computeQuote() | `src/utils/pricing.js` |
| getBasePriceMinor() | `src/utils/pricing.js` |
| Enrollment controller | `src/controllers/enrollment.controller.js` |
| Coupon controller | `src/controllers/coupon.controller.js` |
| Referral controller | `src/controllers/referral.controller.js` |
| Campaign controller | `src/controllers/campaign.controller.js` |
| Enquiry controller | `src/controllers/enquiry.controller.js` |
| Admin user controller | `src/controllers/adminUser.controller.js` |
| Abandoned enrollment controller | `src/controllers/abandoned-enrollment.controller.js` |
| Lead capture controller | `src/controllers/leadCapture.controller.js` |
| Proposal controller | `src/controllers/proposal.controller.js` |
| Instructor form controller | `src/controllers/instructorForm.controller.js` |
| Blog controller | `src/controllers/blog.controller.js` |
| Assessment result controller | `src/controllers/assessmentResult.controller.js` |
| User model (dual-use) | `src/models/user.model.js` |
| Coupon model | `src/models/coupon.model.js` |
| Order model | `src/models/order.model.js` |
| Enquiry model (with AI fields) | `src/models/enquiry.model.js` |
| Campaign model | `src/models/campaign.model.js` |
| Admin user model | `src/models/adminUser.model.js` |
| Instructor model | `src/models/instructor.js` |
| Lead model | `src/models/lead.model.js` |
| AI risk report model | `src/models/aiRiskReport.model.js` |
| JWT helpers | `src/config/jwt.js` |
| Email sender | `src/config/emailService.js` |
| Email templates | `src/utils/emailTemplate.js` |
| Segmentation engine | `src/utils/segmentationEngine.js` |
| Campaign queue | `src/services/campaignQueue.js` |
| Campaign triggers | `src/services/campaignEventTrigger.js` |
| Resend webhook handler | `src/services/resendWebhook.js` |
| Shared Claude client (AI agents) | `src/services/aiAgent.service.js` |
| Recovery email agent | `src/services/recoveryEmailAgent.js` |
| Lead scoring agent | `src/services/leadScoringAgent.js` |
| Admin page constants | `src/constants/adminPages.js` |
| Price catalog (JSON) | `src/data/courses.json` |

## Models Overview
| Model | File | Key Purpose |
|-------|------|------------|
| User | `user.model.js` | Auth + enrollment records (dual-use) |
| Coupon | `coupon.model.js` | Festival coupons with usage tracking |
| Order | `order.model.js` | Paid orders + invoice numbers |
| Enquiry | `enquiry.model.js` | Lead inquiries + AI score fields |
| Campaign | `campaign.model.js` | Email campaigns + segmentation |
| Course | `course.model.js` | Course catalog |
| Instructor | `instructor.js` | Instructor profiles + earnings |
| InstructorApplication | `instructorApplication.model.js` | Gig board applications |
| TrainingRequirement | `trainingRequirement.model.js` | Corporate training RFQs |
| AdminUser | `adminUser.model.js` | Admin/sales/marketing team members |
| Blog | `blogs.model.js` | Blog posts with SEO metadata |
| Subscription | `subscription.model.js` | Newsletter subscriptions |
| Testimonial | `testimonial.model.js` | Student testimonials |
| AssessmentResult | `assessmentResult.model.js` | Course assessment scores |
| CourseView | `courseView.model.js` | Analytics: page view tracking |
| Lead | `lead.model.js` | Multi-persona lead capture |
| Proposal | `proposal.model.js` | Corporate training proposals |
| AIRiskReport | `aiRiskReport.model.js` | AI risk assessment reports |

## API Endpoints Overview

### Payment Endpoints (src/index.js)
```
POST /pricing/quote              # Server-side price computation (public)
POST /stripe/checkout            # Single-course Stripe checkout
POST /stripe/cart-checkout       # Multi-course Stripe checkout
POST /stripe/webhook             # Stripe webhook handler
POST /payments/confirm           # Stripe payment confirmation
POST /razorpay/checkout          # Single-course Razorpay checkout
POST /razorpay/cart-checkout     # Multi-course Razorpay checkout
POST /razorpay/verify            # Single-course Razorpay verification
POST /razorpay/cart-verify       # Multi-course Razorpay verification
GET  /payments/order/:orderId    # Get order details
GET  /payments/my-orders         # My orders (auth required)
POST /api/coupons/validate       # Validate coupon code (public, rate-limited)
GET  /api/coupons/public         # Best coupon for currency (public)
POST /webhooks/resend            # Email bounce/complaint handler
```

### Route Prefixes
```
/              auth, enrollment, enquiry, subscription, blog, chat, course, testimonial, assessment, leadCapture routes
/admin         admin CRUD, analytics, campaigns, proposals, referral analytics, geo/seo
/api           courseView, referral, abandoned-enrollment routes
/api/referral  referral endpoints
/instructor    instructor portal endpoints
```

### Instructor Portal Routes (`/instructor/`)
```
POST /auth/login                 # Instructor login
POST /auth/forgot-password       # Request password reset
POST /auth/reset-password        # Reset password with token
GET  /dashboard                  # Dashboard stats (auth)
GET  /earnings                   # Earnings report (auth)
GET  /gig-board                  # Available assignments (auth)
POST /gig-board/:id/apply        # Apply for gig (auth)
```

## AI Agents

### callClaude() — Shared Client
`src/services/aiAgent.service.js` exports `callClaude({ system, prompt, maxTokens })`.
Uses `claude-sonnet-4-6` model. All AI agents use this shared client.

### Lead Scoring Agent (`src/services/leadScoringAgent.js`)
- Triggered on enquiry creation (fire-and-forget, never blocks response)
- Outputs: `aiScore` (0-100), `aiScoreBand` (hot/warm/cold), `aiReasoning`, `aiDraftReply`, `aiSuggestedFollowUp`
- Stored on `Enquiry` model; fallback = save enquiry without AI fields

### Recovery Email Agent (`src/services/recoveryEmailAgent.js`)
- Generates AI-personalized abandoned-cart recovery emails
- Inputs: course title, training type, form completion %, days abandoned, active coupons for currency
- Fallback: static template from `generateAbandonedCartEmail()` in emailTemplate.js

## Campaign System
- Bull queue: `src/services/campaignQueue.js` (connects to Redis)
- Event triggers: `src/services/campaignEventTrigger.js`
- Segmentation: `src/utils/segmentationEngine.js`
- Metrics tracked via Resend webhook (opens, clicks, bounces)
- Campaign statuses: `draft` → `scheduled` → `running` → `paused` → `sent`

## Environment Variables (never commit)
```
# Database & Auth
MONGO_URI=
JWT_SECRET=                     # User JWT (24h expiry)
ADMIN_JWT_SECRET=               # Admin JWT

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Payments
STRIPE_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

# Email
RESEND_API_KEY=
MAIL_TO=                        # Admin notification email (never hardcode)

# AI
ANTHROPIC_API_KEY=              # Claude API (lead scoring, recovery emails)
OPENAI_API_KEY=                 # OpenAI (Hana chat agent)

# File Uploads
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Redis (Bull queues)
REDIS_HOST=                     # default: 127.0.0.1
REDIS_PORT=                     # default: 6379
REDIS_PASSWORD=                 # optional

# Admin Team Credentials
ADMIN_EMAIL=
ADMIN_PASSWORD=
SALES_EMAIL=
SALES_PASSWORD=
MARKETING_EMAIL=
MARKETING_PASSWORD=

# Server
BASE_URL=                       # Server base URL (used in OAuth callback)
PORT=                           # default: 5000
FRONTEND_URL=                   # Frontend URL for CORS + redirects
WHITELISTED_URLS=               # Comma-separated additional CORS origins
```

## Reference Docs
- `AI_AGENTS_ROADMAP.md` — AI agent roadmap + implemented agents (lead scoring, recovery emails)
- `COUPON_CODES_REFERENCE.md` — festival coupon calendar + discount logic
- `CAMPAIGN_E2E_TESTING.md` — end-to-end test scenarios
- `CAMPAIGN_DEPLOYMENT_CHECKLIST.md` — pre-deploy checklist
- `REDIS_SETUP.md` — Bull queue / Redis configuration
- `RESEND_WEBHOOK_SETUP.md` — Email bounce/complaint webhook setup
