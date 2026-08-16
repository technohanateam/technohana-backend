# Blog Platform Context

## Current-state verification rule

This document describes the implementation verified against the repository on 2026-08-16.

Historical reports are not treated as current truth.

When documentation conflicts with code:
1. Verify the current repository implementation.
2. Treat the repository as the implementation source of truth.
3. Update this document when verified behavior changes.
4. Clearly label assumptions, planned functionality, and unverified findings.

## Public flow (frontend + backend)

- **Model** — `technohana-backend/src/models/blogs.model.js`: single `Blogs` collection with `title`, `slug` (unique/sparse), `img`, `author`/`authorId` (ref `Author`), `date`, `content` (HTML or plain text), `category`, `tags[]`, `excerpt`, `readTimeMin`, SEO fields (`metaTitle`, `metaDescription`, `focusKeyword`), `faqs[]`, `sources[]`, `published` + `scheduledAt` (visibility gate), plus AI Content Factory fields: `contentType` (enum), `valueScores` (content/authority/linkability/business/originality/courseRelevance), `valueScoreSource`, `sourceOpportunityId` (links back to an approved `ContentOpportunity`), `lastReviewedAt`. Schema is defined with `{ timestamps: true }`, so `createdAt`/`updatedAt` are populated by Mongoose on every save.
- **Public routes** — `src/routes/blog.routes.js` → `blog.controller.js`:
  - `GET /blogs` — list (excludes heavy fields via projection), sorted newest first.
  - `GET /blogs/:slug` — JSON single post (populates `authorId`).
  - `GET /blog/:slug` — server-rendered HTML shell with basic OG meta tags, for non-JS crawlers/social-link scrapers (falls back to a "not found" page).
  - All three share `buildPublicBlogFilter()` — the single source of truth for "is this post live" (`published:true` AND `scheduledAt` null or in the past).
- **Frontend listing** — `src/pages/Blog.jsx`: fetches `/blogs`, client-side category filter, tag filter via URL param, search, pagination (6/page), sidebar, subscription CTA.
- **Frontend detail page** — `src/pages/BlogPost.jsx`: fetches the requested post via the dedicated `GET /blogs/:slug` endpoint and separately fetches `GET /blogs` (full list) in parallel, used only to populate the related-posts section (`BlogPost.jsx:197-200`). The SPA does **not** fetch the full list to locate the requested post by slug. Detects HTML vs plain-text content and renders accordingly; injects heading IDs into HTML content for a table of contents; auto-links course mentions (`autoLinkContent`); sanitizes HTML with DOMPurify.
- **Components** — `BlogCard.jsx`, `BlogSidebar.jsx`, `Pagination.jsx`, `BlogCoverLandscape.jsx`, `Home/BlogPreview.jsx`.

## Admin authoring — `src/pages/admin/AdminBlogs.jsx` (2,500+ lines) + `admin.routes.js`

- CRUD: `GET/POST/PUT/DELETE /admin/blogs`, publish/schedule toggle, bulk publish/delete, static-post seeding.
- `BlogModal` with Content / SEO / Internal Links tabs (plus AI Content Factory review-only tabs — Sources / Image / AI Quality — shown only when a `reviewContext` is passed). SEO tab shows a 0–5 checklist score plus separate character-count guidance (see "SEO checklist scoring" below); cover image upload or auto-generated via `html-to-image`.
- **AI generation** (manual Claude Pro workflow, not live API calls): generate a post from a course, from source URLs, or rewrite an existing post — these endpoints build a prompt, the admin pastes it into Claude Pro, and pastes the response back in.
- **AI value-score estimation**, **AI internal-link suggestions** (course + related-post linking, `smartLinkCoursesInBlog.js` scores courses by title/keyword/category match against `courses.json`).
- **Auto-schedule**: spreads draft posts across upcoming dates at a configurable interval.
- Admin routes gated by `authenticateAdmin` + `requirePage("blogs")`, with `requireAdmin`/`requireMarketing` role splits for destructive vs. editorial actions.

## AI Content Factory integration

Posts can originate from an approved `ContentOpportunity` (`sourceOpportunityId`), carry AI-estimated value scores, and feed the SEO/freshness admin dashboards (`lastReviewedAt` drives a freshness scan service). `AdminBlogs.jsx` also renders an AI-generation quality gate (`QualityTab`: dimension scores, flagged-for-revision reasons, fact-check findings, revision history) when a `reviewContext` is supplied — this applies to the AI Content Factory's pre-publish review step, not to the `Blogs` document schema itself (see "Editorial workflow states" below).

## Verified current behavior

**Structured data (`BlogPost.jsx:329-388`)** — JSON-LD is generated dynamically from post fields, not hardcoded:
- `BlogPosting`: `datePublished` from `post.date`; `dateModified` from `post.updatedAt || post.date`.
- Author graph switches on `post.authorId` (populated `Author` doc: name, jobTitle, bio, LinkedIn, credentials) when present, falling back to a plain `Person` built from the string `post.author` field when it isn't.
- `citation` entries are generated from `post.sources[]` when present.
- A `FAQPage` block is appended only when `post.faqs[]` is non-empty, built directly from those FAQ entries.
- `BreadcrumbList` (Home → Blog → post) is the one static/hardcoded JSON-LD block.

**`dateModified` behavior** — The `Blogs` schema is declared with `{ timestamps: true }` (`blogs.model.js:104`), so Mongoose maintains a real `updatedAt` on every save, distinct from the editorial `date` field. `BlogPost.jsx` uses `post.updatedAt || post.date` for `dateModified`, so the modified date reflects actual edits once a post has been saved after creation, rather than always mirroring `datePublished`.

**SEO checklist scoring (`admin/AdminBlogs.jsx:114-123`)** — `getSeoScore()` awards exactly 1 point each for **presence** (truthy check, not length) of `metaTitle`, `metaDescription`, `focusKeyword`, `excerpt`, and `img` — five possible points total. The 50–60 character (meta title) and 140–160 character (meta description) ranges shown in the editor come from a separate `CharCounter` UI component that colors a live character count; those ranges are editor guidance only and are **not** inputs to the 0–5 score calculation.

**Client-rendered SEO metadata (`components/SEO/SEOHead.jsx`)** — Applied via a `useEffect` after the SPA mounts. Sets `<link rel="canonical">`, `meta[name=robots]` and `meta[name=googlebot]`, `twitter:card`/`twitter:image`/`twitter:site`, full Open Graph tags, and `hreflang` alternates (`en-IN`, `en`). This metadata is present for any client that executes the SPA's JavaScript, including modern search-engine crawlers that render JS.

**Admin content editor (`admin/AdminBlogs.jsx`)** — The Content tab's editor is a plain `<textarea>` (`textareaRef`, lines ~902) with an Edit/Preview mode toggle (`editorMode` state). No Markdown or rich-text/WYSIWYG editor library (e.g. TipTap, Quill) is used or imported anywhere in the file.

**Plain-text content renderer (`BlogPost.jsx:54-149`, `renderContent`)** — Handles, per double-newline-delimited block: bullet lists (`-`, `•`, `*` prefixes), numbered lists (`1.` / `1)` prefixes), inline bold (`**text**`) and links (`[text](url)`) via `parseInline`, and headings — detected by a leading emoji character or a `#`/`##`/`###` Markdown-style prefix, rendered as `<h2>` regardless of the `#` count. It does **not** parse Markdown tables, fenced code blocks, or blockquotes — no code path in `renderContent` recognizes ``` ``` ```, `>`, or pipe-delimited table syntax.

**Editorial workflow states** — The `Blogs` schema (`blogs.model.js`) exposes only `published` (Boolean) and `scheduledAt` (Date|null) for visibility control; there is no additional `status` enum (e.g. draft/review/approved/archived) on the `Blogs` collection itself. Separately, `AdminBlogs.jsx` contains UI state for a revision/reject flow (`revisionNote`, `rejectReason`, `showRevisionInput`, `showRejectInput`) gated behind `reviewContext` — this is the AI Content Factory's pre-publish review step on `ContentOpportunity` records, not an additional state on the `Blogs` document schema. The relationship between that review flow and blog-document lifecycle was not traced in this pass — see "Not yet verified."

## Verified current gaps

**SSR crawler shell lacks canonical/robots/Twitter metadata** — `GET /blog/:slug` (`blog.controller.js:47-89`) is a separate, non-JS server-rendered HTML shell used by bots and social-link scrapers that don't execute JavaScript. It emits only `<title>` and `og:title`/`og:description`/`og:image`/`og:url`. It does not emit a canonical `<link>`, `twitter:card`/Twitter meta tags, or a `robots` meta directive. This is a real, narrow gap limited to that non-JS shell — the client-rendered SPA page (via `SEOHead.jsx`) already supports canonical, robots, and Twitter Card metadata, so those are not absent from the platform as a whole.

## Still-verified limitations (carried forward from the historical report)

- No true Markdown editor or WYSIWYG rich-text editor in the admin Content tab (plain textarea + preview toggle only).
- No table, fenced-code-block, or blockquote support in the plain-text content renderer.
- No additional `Blogs`-document-level editorial status beyond `published` + `scheduledAt`.

## Not yet verified

- Whether/how the AI Content Factory's `ContentOpportunity` review/revision/reject workflow (`reviewContext`, `revisionNote`, `rejectReason` in `AdminBlogs.jsx`) transitions a record into or out of the `Blogs` collection, and whether any additional state is stored on the `Blogs` document during that process.
- Whether Googlebot (or other crawlers that do execute JS) reliably picks up the client-rendered `SEOHead.jsx` metadata in practice, versus falling back to the non-JS SSR shell's incomplete metadata — this is a runtime/indexing question, not something confirmable from source alone.

## Historical findings (from `BLOG_PLATFORM_ENHANCEMENT_REPORT.md`, dated 2026-07-05) — resolved

The enhancement report captured the CMS's state as of July 2026. The following findings are resolved as of this verification (2026-08-16) and are listed here for traceability only — they are not current gaps:

- **Resolved** — "Schema markup hardcoded rather than content-driven." Current: FAQ, sources, and author JSON-LD are built dynamically from post fields (see "Structured data" above).
- **Resolved** — "No separate published/modified dates." Current: `dateModified` uses `post.updatedAt` via the model's `{ timestamps: true }`.
- **Resolved** — "No canonical URL field, no OG/Twitter image overrides, no robots directive." Current: present for the client-rendered SPA page via `SEOHead.jsx`. Narrowed, not eliminated — still open for the non-JS SSR bot-facing shell only (see "Verified current gaps" above).
- **Resolved** — "No server-side single-post fetch is used by the SPA route." Current: `BlogPost.jsx` calls `GET /blogs/:slug` directly for the requested post.
- **Superseded (not simply resolved)** — The report described heading detection in the plain-text renderer as a length/punctuation heuristic ("line ≤90 chars, no trailing punctuation"). Current `renderContent` instead detects headings via a leading emoji character or a Markdown-style `#` prefix — a different mechanism than previously documented, still with no true Markdown parsing.

Findings still open (unchanged from the report, reconfirmed above): no Markdown/WYSIWYG editor; no table/code-fence/blockquote support in the plain-text renderer; no editorial workflow states beyond `published` boolean + `scheduledAt` on the `Blogs` collection.
