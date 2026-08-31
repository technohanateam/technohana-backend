# AI Agents Roadmap — Making Technohana Fully AI-Native

This document maps every AI agent in (or planned for) the Technohana platform, across both
codebases:

- **Node backend** (`technohana-backend`) — business/operations agents tied to MongoDB models,
  the Resend email pipeline, and the Bull campaign queue.
- **Python Hana service** (`technohana-frontend-master/backend/`, FastAPI) — learner-facing
  conversational agents.

## Already live — Python Hana service

| Agent | File | Purpose |
|---|---|---|
| Course Advisor (Hana chat) | `agents/course_advisor.py` | Visitor chat: discovery → recommendation → lead capture → enrollment link |
| Skills Gap | `agents/skills_gap_agent.py` | Current role → target role → gap analysis → course picks |
| Assessment Generator | `agents/assessment_agent.py` | Fresh course-specific MCQs per call |
| Learning Roadmap | `agents/roadmap_agent.py` | 30-60-90 day plans for enrolled learners |
| Interview Coach | `agents/interview_agent.py` | Question generation + answer evaluation |
| LinkedIn Optimizer | `agents/linkedin_agent.py` | Profile rewrite based on course learnings |
| Content Calendar | `agents/content_calendar_agent.py` | Social content plans for learners |

## Implemented in this backend

### 1. Abandoned Enrollment Recovery Agent ✅
**Files:** `src/services/recoveryEmailAgent.js`, `src/services/aiAgent.service.js`,
`src/utils/emailTemplate.js` (`generateAiRecoveryEmail`)

Replaces the static abandoned-cart email with a Claude-personalized one.

- **Trigger points:** the 30-minute abandoned-cart interval in `src/index.js`, and the manual
  `sendEnrollmentReminder` endpoint in `src/controllers/abandoned-enrollment.controller.js`.
- **Inputs:** saved `enrollmentFormData` (course, training type, participants, fields completed),
  days since abandonment, and **active coupons queried from MongoDB** filtered by the user's
  currency (never hardcoded).
- **Output:** subject + body HTML, sanitized and slotted into the trusted branded email shell.
  The CTA link is built server-side — the model never emits URLs.
- **Fallback:** any failure (missing `ANTHROPIC_API_KEY`, API error, bad JSON) returns `null`
  and the existing static `generateAbandonedCartEmail` template is sent instead. Sends never
  block on AI.

### 2. Lead Scoring & Triage Agent ✅
**Files:** `src/services/leadScoringAgent.js`, `src/models/enquiry.model.js` (new `ai*` fields),
`src/controllers/enquiry.controller.js`, `src/routes/admin.routes.js`

Scores every enquiry on creation and drafts a first reply for sales.

- **Trigger:** fire-and-forget after `enquiry.save()` in `createEnquiry` and `contactUs` —
  submission never blocks or fails on AI errors.
- **Stored on Enquiry:** `aiScore` (0-100), `aiScoreBand` (hot/warm/cold), `aiReasoning`,
  `aiDraftReply`, `aiSuggestedFollowUp`, `aiScoredAt`.
- **Admin endpoints** (both `authenticateAdmin`):
  - `GET /admin/enquiries/ranked` — open leads (new/contacted) sorted by score
  - `POST /admin/enquiries/:id/rescore` — re-run scoring on demand

### 3. Churn / At-Risk Learner Agent ✅
**File:** `src/services/atRiskLearnerAgent.js`

Daily scan (see `setInterval` in `src/index.js`) of learners inactive 14+ days; sends a
personalized nudge per user via Resend, referencing their course and progress. No discounts
or prices mentioned. Never throws — logs and continues on a per-user failure.

### 4. Campaign Copywriter Agent ✅
**File:** `src/services/campaignCopywriterAgent.js`, orchestrated by
`src/services/emailMarketing/campaignGenerationOrchestrator.js`

Brief → subject line, preview text, HTML body, and 2 A/B variant subjects, written into the
Campaign model. Strips any URL/price/coupon-code-like pattern the model emits. Generation now
runs through the Quality Gate (below) before a campaign is sendable.

### 5. Campaign Quality Gate & Human Review ✅
**File:** `src/services/emailMarketing/campaignQualityGate.js`

Analog of the blog Content Factory's quality gate. After copy generation, runs a hard
compliance check (no raw URLs/prices/coupon codes, subject/body present and sized sanely) and
an AI style check (flags generic-sounding or manipulative-urgency copy). On failure, triggers
one automatic revision pass (capped) via the copywriter agent, then routes the campaign to
`reviewStatus: "needs_revision"` for a human, or `"approved"` if clean. `sendCampaignNow` and
`scheduleCampaign` both refuse to run a campaign still in `pending_review`/`needs_revision`.
Admin endpoints: `POST /admin/campaigns/:id/copy/approve`, `POST /admin/campaigns/:id/copy/reject`.

### 6. Campaign Opportunity Engine ✅
**File:** `src/services/emailMarketing/campaignOpportunityJob.js`, model
`src/models/campaignOpportunity.model.js`

Analog of the blog Content Factory's daily planning job. Runs once daily (`setInterval` in
`src/index.js`, also triggerable via `POST /admin/campaigns/opportunities/run-now`) and scans
existing signals — at-risk learners, abandoned enrollments (3+ days), hot leads past their
follow-up date, coupons expiring within 7 days, users inactive 30+ days — to propose campaigns
rather than sending anything itself. An admin reviews proposals at
`GET /admin/campaigns/opportunities` and approves one (`POST .../:id/approve`) to create a
draft Campaign pre-filled with the suggested segment + brief, ready for AI copy generation.

### 7. Per-Recipient Campaign Personalization ✅
**File:** `src/services/emailMarketing/campaignPersonalizer.js`

Generalizes the recovery-email agent's per-user personalization pattern to any campaign that
opts in (`campaign.personalize: true`). At send time (`campaignQueue.js` and
`sendCampaignNow`), fills a `<!-- PERSONALIZE -->` marker in the approved HTML with one
AI-written sentence using the recipient's segmentation attributes (course, city, training
type, referral status). Never regenerates the human-approved copy wholesale, and falls back to
the marker being silently removed on any failure — sends never block on this.

### Shared infrastructure
`src/services/aiAgent.service.js` — lazy singleton Anthropic client (`claude-sonnet-4-6`
standard tier, `claude-haiku-4-5-20251001` cheap tier), `callClaude()` + `extractJson()`.
Requires `ANTHROPIC_API_KEY` (already used by `src/routes/chat.routes.js`).

## Planned — backend agents (in suggested priority order)

| # | Agent | What it does | Existing infra it plugs into |
|---|---|---|---|
| 8 | **Quote / Negotiation** | Drafts corporate/group proposals using server-side `computeQuote()` pricing | Pricing engine in `src/index.js`, Enquiry pipeline fields |
| 9 | **Segment Discovery** | Proposes new audience segments in the segmentation engine's custom-filter format | `src/utils/segmentationEngine.js` |
| 10 | **Adaptive Assessment Feedback** | Turns AssessmentResult answers into a personalized study plan | AssessmentResult model, Python roadmap agent |
| 11 | **Progress Coach** | Dashboard check-ins ("you're 60% through, here's what's next") | User progress fields, dashboard components |
| 12 | **A/B Winner Auto-Promotion** | Uses `Campaign.recipientMetrics` open/click data to auto-promote a variant instead of a fixed 50/50 split | Campaign variants, Resend webhook metrics |
| 9 | **Coupon / Pricing Analyst** | Reviews coupon usage + order discount data, recommends festival calendar changes | Coupon usage counters, Order discount fields |
| 10 | **Support Deflection in Hana** | Extends the course advisor with tools for order status, certificates, refunds | Python Hana service + Node API endpoints |

## Guardrails (apply to every agent)

1. **AI never blocks the critical path** — fire-and-forget or fallback-on-failure only.
2. **Never trust model-emitted prices, URLs, or coupon codes** — pricing via `computeQuote()`,
   coupons queried from MongoDB, links built server-side.
3. **Model HTML is sanitized** and rendered only inside the trusted email shell.
4. **Admin-facing endpoints always use `authenticateAdmin`.**
5. One shared client/config in `src/services/aiAgent.service.js` — don't scatter SDK setup.
