# Liberty Library Platform
## Developer Checklist
### Version IV — Engineering Backlog & Roadmap

> **Note:** This document is NOT a system instruction. It is a structured engineering backlog. Items here are NOT automatically approved. Always verify against the current schema, working architecture, and migration safety before implementing.

---

### COMPLETED

#### Infrastructure
* R2 upload presign + confirm three-step flow 
* JWT auth canonicalization (lib/auth.ts, role claims, HS256) 
* Shared Zod validation layer (lib/parseBody.ts + lib/schemas.ts) 
* Sliding window rate limiter (disabled in dev) 
* proxy.ts route protection 
* Cloudflare Worker: queue consumer + cron orphan sweep 
* fetchWithAuth wired into all authenticated pages 
* add_missing_indexes migration applied 

#### Admin Panel
* Student CRUD: list, detail, edit, password reset, archive/unarchive, RP total 
* Payment approval flow with secure R2 receipt viewing 
* Content library: upload, preview, edit, archive, assessment slot badges 
* Daily task creation: all formats, question bank, writing constraints, RP config 
* Admin daily review with structured Q&A display 
* Assessment review with session tabs, allSessions artifacts, assign/update level 
* Assessment config panel: initialSessionCount, slot readiness grid 
* Assessment content slots: assign per (level, skill, sessionNumber) 
* Question bank builder in assessment slot panel (mixed formats, always-visible selector) 
* Periodic re-evaluation trigger (all / by level) 
* Student activity monitor with per-skill breakdown 
* AdminAuditLog writes: level assigned, level changed, profile edited, periodic triggered 

#### Student Flow
* Registration with R2 receipt upload + favourite subjects 
* Student login with archived account blocking 
* Initial assessment: multi-session, level-aware content, one-shot submit 
* Assessment: time-aware "take tomorrow" recommendation between sessions 
* Periodic re-evaluation: pending banner, submitted banner 
* Daily tasks: all formats, 3-retry structured listening, writing constraints, RP 
* Student dashboard: RP total, today tasks, all assessment state banners 
* Student logout 

---

### COMPLETED (Session X)

#### Multi-session periodic assessments
* Added `periodicSessionCount Int @default(1)` to `AssessmentConfig` and `periodicCycleNumber Int?` to `Assessment` (migration: `add_periodic_session_count_cycle`)
* `trigger-periodic` now uses `periodicCycleNumber` to track re-evaluation cycles; each trigger always creates `sessionNumber: 1` of a new cycle
* `submit/route` uses `periodicSessionCount` for periodic last-session logic; creates next periodic session within the same cycle (propagating `periodicCycleNumber`); child status stays `active` throughout
* `student/assessment/route` returns `periodicSessionCount` as `totalSessions` for periodic; slot lookup uses `assessment.sessionNumber` directly (no longer hardcoded to 1)
* Admin list (`/api/admin/assessments`) deduplicates periodic by `(childId, periodicCycleNumber)` — shows as soon as any session submitted, same as initial
* Admin detail (`/api/admin/assessments/[id]`) scopes `allSessions` to same `periodicCycleNumber` for periodic
* Config route GET/PUT handles `periodicSessionCount`; PUT validates it ≤ `initialSessionCount` (shared slots)
* Admin config panel: new "Periodic sessions per re-evaluation" input; capped at `initialSessionCount`
* Admin list cards: "Session X of Y — more sessions pending" badge shown for multi-session periodic (same pattern as initial)
* Session tabs: "Student has not yet submitted this session." shown instead of "No artifacts" for unsubmitted sessions (both main panel and history)

---

### COMPLETED (Session IX)

#### Assessment review UI (admin)
* ISSUE-26: Pending list split into "Initial Placement" (blue) and "Periodic Re-evaluation" (indigo) sections with per-section counts
* Type badge added to detail panel header — prominent colored label identifies assessment kind at a glance
* Periodic review panel shows "Current level: X" above the level selector
* Action label changes to "Update level…" for periodic (vs "Save" for initial)
* Two-step confirmation for periodic level updates: amber callout showing "change [Student]'s level from [X] to [Y]" with Confirm / Cancel
* History list kind badges aligned to same blue/indigo color scheme

---

### COMPLETED (Session VIII)

#### Admin student panel
* Per-student periodic trigger button in student detail panel — `scope: "student"` added to `trigger-periodic` route; two-step confirmation UI; only visible for active non-archived students; audit action fixed from `LEVEL_CHANGED` → `PERIODIC_TRIGGERED` for all scopes (ISSUE-23)

---

### COMPLETED (Session VII)

#### Daily task management (admin)
* Admin delete daily task — DELETE /api/admin/daily-tasks/[taskId], blocked if any submission isCompleted, two-step confirmation UI
* ISSUE-13 confirmed already implemented — default-content DELETE rejects clearing slots within initialSessionCount

#### Daily task listening (student)
* Client-side scoring for attempts 2 and 3 — only attempt 1 persisted to DB; attempts 2–3 score locally against correct answers returned from attempt 1; attempt 3 posts lock-only (no answers) to server

---

### COMPLETED (Session VI)

#### Assessment review (admin)
* Admin can review session 1 artifacts immediately after submission (no longer waits for all sessions)
* Pending list shows "Session N of M — more sessions pending" or "All N sessions submitted — ready for level assignment"
* Assign level button only appears on the last session tab
* Assign level now sends the active (last) session's ID — not the clicked list-row's ID
* Admin artifact panel shows source content title + collapsible text / audio download link
* Periodic assessment "check back soon" bug fixed — slots always looked up at session 1

#### Student dashboard
* Session counter on assessment_required banner: "Session X of Y" pill with contextual description
* Unknown Word List / vocabulary pool — storage model undefined, consumption unclear

#### Slot management (admin)
* Protected slots (within saved session count) show "Replace with…" dropdown instead of blocked Clear
* Missing slots shown as grouped clickable list with quick-navigate to level panel
* Empty slot rows highlighted amber

---


### SPRINT PLAN — Approved Implementation Sequence

> Items below are ordered. Each sprint is one implementation session. Do not skip ahead.
> Full specs for each item are in the referenced `.claude/` files.

---

#### Sprint 1 — Mobile Responsiveness (ISSUE-24)

**Scope:** Pure frontend. No schema changes. No new routes.

Student pages (in order):
1. `/student` (dashboard) — layout, subscription banners, nav at 375px
2. `/student/assessment` — writing textarea (`dvh`), audio recorder touch targets, iOS Safari `MediaRecorder` format detection
3. `/student/tasks/[taskId]` — listening player controls, writing constraints display, audio recorder
4. `/student/subscription` + `/student/subscription/renew` — receipt upload, mobile form layout
5. `/student/words` — word list, add-word input
6. `/student/profile` — form layout

Admin panel: no horizontal overflow at 768px (tablet) minimum — fix overflow only, full mobile not required.

**Tailwind rules:**
- Use `sm:` and `md:` breakpoints throughout
- Minimum touch target: 44×44 px (`min-h-[44px] min-w-[44px]`)
- Base font: `text-base` (16px) minimum on all student pages
- Navigation: no horizontal scroll at 375px

---

#### Sprint 2 — In-Context Unknown Word Panel

Completed / IMPLEMENTED ✔

#### Sprint 3 — Word Definition Lookup  IMPLEMENTED ✔

**Scope:** Schema migration + data import script + new API route + UI on words page.

Full spec: `.claude/dictionary.md`

Steps:
1. Schema migration `add_dictionary_entries` — add `DictionaryEntry` model
2. Optional: migration `add_unknown_word_definition_cache` — add `definition String?` to `UnknownWord`
3. Download WordNet 3.1 + CMUdict data files (do not commit — add to `.gitignore`)
4. Write `scripts/import-dictionary.ts` — parse + bulk insert via `createMany`
5. Run import locally, verify counts, spot-check entries
6. Add `GET /api/student/dictionary?word=X` route (student auth, exact-match PK lookup)
7. Add "Look up" expand UI to each word row on `/student/words`
8. Apply migration + run import on production (Supabase)

---

#### Sprint 4 — Admin Word Insights IMPLEMENTED ✔

**Scope:** New admin route + small UI section in student detail panel.

**No schema change.**

Build:
- `GET /api/admin/students/[childId]/unknown-words` — returns paginated word list for one student
- Section in student detail panel (`app/admin/students/page.tsx`) showing student's saved words
- Optional global aggregate: `GET /api/admin/analytics/words` — top 20 most saved words across all students (can be folded into Sprint 7 analytics instead)

---

#### Sprint 5 — Email Notifications ✔ (implemented)

**Scope:** One schema migration + new lib file + wiring into existing routes.

Full spec: `.claude/notifications.md`

- `npm install resend` — resend@6.10.0
- Migration `add_child_renewal_reminder_at` — `lastRenewalReminderAt DateTime?` added to `Child`
- `lib/email.ts` — provider-agnostic: private `sendEmail()` is the only Resend-aware function; all 5 domain functions are provider-agnostic. To switch providers: replace `sendEmail()` only.
- Event 1 (payment approved) wired in `POST /api/admin/payments/[id]/approve`
- Event 2 (level assigned) wired in `POST /api/admin/assessments/assign-level` — fires for initial and periodic
- Event 4 (renewal approved) wired in `POST /api/admin/subscriptions/[id]/approve`
- Event 5 (expiry warning) wired in `GET /api/student/subscription` — 3-day cooldown via `lastRenewalReminderAt`
- Event 3 (task created fan-out) wired in `POST /api/admin/daily-tasks` — query + send runs OUTSIDE transaction
- ENV: `RESEND_API_KEY`, `EMAIL_FROM` (fallback hardcoded in `lib/email.ts`)

---

#### Sprint 6 — Security: Redis Rate Limiter (SEC-07)

**Blocked on:** Upstash account (requires payment card).

Full design: `.claude/dev_checklist.md` §SEC-07 section below.

Steps (ready to execute once credentials available):
1. `npm install @upstash/redis`
2. Rewrite `lib/rateLimit.ts` to async Upstash sorted-set pipeline
3. Add `await` to 5 call sites
4. Add env vars to `.env` + `README.md`

---

#### Sprint 7 — Analytics Dashboard

**Scope:** New API route + new admin page + recharts.

Full spec: `.claude/analytics.md`

Steps:
1. `npm install recharts`
2. `GET /api/admin/analytics` — all 6 panels, cached 15 min
3. `app/admin/analytics/page.tsx` — 6-panel grid
4. Add "Analytics" link to admin nav

---

#### Sprint 8 — Refresh Token Flow

**Scope:** Schema migration + new route + client-side interceptor in `fetchWithAuth`.

Steps:
1. Schema migration: `RefreshToken` model (hashed token, childId/adminId, expiresAt, revokedAt, userAgent)
2. `POST /api/student/refresh` + `POST /api/admin/refresh`
3. Update `lib/fetchWithAuth.ts` to intercept 401, attempt silent refresh, retry once
4. Update login routes to set both access token cookie and refresh token cookie

---

#### Sprint 9.5 — Daily Task Reminder (Scheduled Email)

**Scope:** No schema change. New email function + new internal route + worker cron addition.

Full spec: `.claude/notifications.md` § 9

Steps:
1. Add `sendDailyTaskReminderEmail` to `lib/email.ts`
2. Create `app/api/internal/daily-reminder/route.ts` — POST, protected by `x-worker-secret`, same pattern as `/api/internal/orphan-sweep`
3. Add `handleDailyReminders` to `worker/src/index.ts` (calls new route)
4. Add second cron to `worker/wrangler.toml` (e.g. `"0 7 * * *"` = 8 AM WAT)
5. Route `event.cron` in `scheduled` handler
6. Redeploy worker: `cd worker && npx wrangler deploy`

**Key constraint:** Resend free tier = 100 emails/day. Exceeding active student count of ~100 requires a paid plan.

---

#### Sprint 9 — Admin-Configurable Recording Duration

**Scope:** One schema migration + one input in task creation + enforcement in audio recorder.

Steps:
1. Schema migration `add_task_recording_duration`: add `maxRecordingSeconds Int @default(120)` to `DailyTask`
2. Add input to admin task creation form
3. Return `maxRecordingSeconds` from `GET /api/student/daily-tasks/[taskId]`
4. Enforce in audio recorder component

---

### PENDING — NEAR TERM

* ~~**ISSUE-17:**~~ Grade range enforcement — enforced 1–12; grades 7–12 map to `advanced` level. ✔

* **ISSUE-24:** Mobile/PC responsiveness audit — **Sprint 1.** See sprint plan above.

* ~~**ISSUE-25:**~~ Admin student status clarity — action hints per status, periodic pending badge (list + detail), `lastDailySubmissionAt` staleness indicator. ✔

* Refresh-token flow — **Sprint 8.** See sprint plan above.
* Redis-backed rate limiter — **Sprint 6.** See sprint plan above (SEC-07 section unchanged below).

---

### PENDING — PRE-LAUNCH (billing)

#### ISSUE-18: Payment event table ✔ (implemented)
* `PaymentEventType` enum + `PaymentEvent` model — migration applied
* `PAYMENT_SUBMITTED` written at registration; `PAYMENT_APPROVED` / `PAYMENT_REJECTED` at admin review
* Approve route auth wired (was missing — fixed in same pass)
* `GET /api/admin/payments/[id]/events` route added
* Event history toggle on `/admin/payments` page

#### ISSUE-19: Monthly subscription renewal ✔ (implemented Session XI)
> Full spec: `.claude/billing-subscription.md`

**Schema (new migration: `add_billing_subscription`):**
* `BillingConfig` — single-row config table (cycleDays, gracePeriodDays, renewalWindowDays, monthlyFee, currency)
* `Subscription` — append-only history table (periodStart, periodEnd, renewalPaymentId?)
* `RenewalPayment` — separate from registration Payment; has its own approve/reject flow
* `RenewalPaymentStatus` enum (pending, approved, rejected)
* `Child.subscriptionExpiresAt DateTime?` — denormalized cache of latest Subscription.periodEnd
* Add `AuditAction` values: `RENEWAL_APPROVED`, `RENEWAL_REJECTED`, `SUBSCRIPTION_OVERRIDDEN`

**Routes (new):**
* `GET/POST /api/student/subscription` — current subscription state + renew submission
* `POST /api/student/subscription/renew` — creates RenewalPayment + PaymentEvent
* `GET /api/admin/subscriptions` — list RenewalPayments by status
* `POST /api/admin/subscriptions/[id]/approve` — creates Subscription row, updates Child.subscriptionExpiresAt, writes PaymentEvent; new periodStart = prev.periodEnd
* `POST /api/admin/subscriptions/[id]/reject` — writes PaymentEvent
* `GET/PUT /api/admin/billing-config` — read/upsert BillingConfig
* `PATCH /api/admin/students/[childId]/subscription` — admin manual override of subscriptionExpiresAt

**Routes (modified):**
* `POST /api/admin/payments/[id]/approve` — add: create first Subscription row + update Child.subscriptionExpiresAt at registration approval

**Access control (student submission routes):**
* Check `subscriptionExpiresAt` before allowing task/assessment submission
* null = allow (grandfathered); within grace = allow + banner; past grace + active = 402 block
* Pre-active students: never blocked by billing, flagged to admin only

**UI (new pages):**
* `/student/subscription` — days remaining, fee, renew button (enabled ≤ renewalWindowDays before expiry)
* `/student/subscription/renew` — amount display, receipt upload or transaction ID, submit
* `/admin/subscriptions` — pending/approved/rejected renewal list; same pattern as /admin/payments
* Admin config panel — billing config section (cycleDays, gracePeriodDays, renewalWindowDays, monthlyFee)
* Student detail panel — subscription status, expiry date, override button

**Migration data step:**
* For all non-rejected, non-pending_payment children: create Subscription row (periodStart = Payment.reviewedAt ?? Payment.createdAt, periodEnd = periodStart + 30 days), set Child.subscriptionExpiresAt = periodEnd

**Future premium tier (designed, not implemented):**
* `SubscriptionTier` enum (standard, premium) on `Subscription` row
* `ContentItem.tier` field for content gating
* Subject-specific premium libraries: GIS, Aviation English, Academic prep, subject-specific literacy
* Payment gateway integration: webhook creates Subscription row, updates cache atomically
* See `.claude/billing-subscription.md` § 9 for full premium architecture notes

---

### DEFERRED — Security (requires Upstash account / card)

#### SEC-07: Redis-backed rate limiter

**Blocked on:** Upstash account creation (requires payment card).

**Why it matters:** `lib/rateLimit.ts` uses a process-local `Map`. On Vercel serverless, each cold-start instance has its own counter — an attacker rotating across instances effectively multiplies allowed attempts by the instance count. Login limits (`adminLogin: 5/15 min`, `studentLogin: 10/15 min`) are the most critical to enforce correctly.

**Design decisions already agreed:**
- **Provider:** Upstash Redis (HTTP-based, serverless-safe, no persistent connections). Two env vars to add: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- **Algorithm:** Keep the existing sliding window log, backed by a Redis sorted-set pipeline (`ZREMRANGEBYSCORE` → `ZADD` → `ZCARD` → `EXPIRE`). One package: `@upstash/redis`. Do NOT use `@upstash/ratelimit` package — hand-rolled is transparent and sufficient.
- **On Redis failure:** Fail-open (allow the request, `console.error`). Blocking all logins during a Redis outage is a worse outcome than a short unprotected window.
- **Dev behaviour:** Unchanged — rate limiting stays disabled when `NODE_ENV === "development"` (all localhost requests share the same "unknown" IP which exhausts limits instantly).

**Implementation steps (ready to execute once Upstash credentials are available):**
1. `npm install @upstash/redis`
2. Rewrite `rateLimit()` in `lib/rateLimit.ts` to be `async`, using a sorted-set pipeline against Upstash. Keep `RATE_LIMITS`, `getClientIp`, `formatRetryAfter` signatures unchanged.
3. Add `await` to all 5 call sites:
   - `app/api/admin/login/route.ts`
   - `app/api/student/login/route.ts`
   - `app/api/upload/presign/route.ts`
   - `app/api/admin/content/route.ts`
   - `app/api/register/route.ts`
4. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to `.env` and `README.md`.
5. Mark SEC-07 fixed in `.claude/security-audit.md`.

**Test impact:** None — all tests mock `@/lib/rateLimit` at the module level (`jest.mock`). No test file changes needed.

---

### DEFERRED — P3+
* ~~Admin-configurable recording duration per task~~ → **Sprint 9** (promoted, designed)
* ~~Parent notification system (SMS/email)~~ → **Sprint 5** (promoted, designed in `.claude/notifications.md`)
* ~~Analytics dashboard~~ → **Sprint 7** (promoted, designed in `.claude/analytics.md`)
* AI evaluation layer: writing scoring, pronunciation, comprehension grading
* Adaptive difficulty / vocabulary progression model
* AI writing evaluation rubric
* Behavioral engagement analytics (requires event tracking schema first)
* Teacher intervention tools
* Multi-tenant / cohort architecture
* Premium subscription tier (GIS, Aviation English, subject-specific content) — architecture designed in `.claude/billing-subscription.md` § 9 + `.claude/payment-plans.md`
* Third-party payment gateway integration (Stripe / PayMongo) — deferred until user volume justifies per-transaction fees

---

### ENGINEERING DISCIPLINE RULES
* Items in this checklist are NOT automatically approved 
* Always verify against system instruction, current schema, migration safety 
* Never break state machine, automate admin authority, or redesign upload pipeline casually 
* Major lifecycle features require: schema design, migration sequencing plan, backward compat analysis 