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


### PENDING — NEAR TERM

* ~~**ISSUE-17:**~~ Grade range enforcement — enforced 1–12; grades 7–12 map to `advanced` level. ✔

* **ISSUE-24:** Mobile/PC responsiveness audit — student-facing pages first (dashboard, assessment, tasks, audio recorder). Admin panel: no horizontal overflow at tablet width minimum.

* ~~**ISSUE-25:**~~ Admin student status clarity — action hints per status, periodic pending badge (list + detail), `lastDailySubmissionAt` staleness indicator. ✔

* Refresh-token flow — deferred
* Redis-backed rate limiter — deferred

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

### DEFERRED — P3+
* Admin-configurable recording duration per task 
* Parent notification system (SMS/email) 
* Analytics dashboard — requires event tracking architecture first 
* AI evaluation layer: writing scoring, pronunciation, comprehension grading 
* Adaptive difficulty / vocabulary progression model 
* AI writing evaluation rubric 
* Behavioral engagement analytics 
* Teacher intervention tools 
* Multi-tenant / cohort architecture
* Premium subscription tier (GIS, Aviation English, subject-specific content) — architecture designed in `.claude/billing-subscription.md` § 9
* Third-party payment gateway integration (Stripe / PayMongo) — deferred until user volume justifies per-transaction fees 

---

### ENGINEERING DISCIPLINE RULES
* Items in this checklist are NOT automatically approved 
* Always verify against system instruction, current schema, migration safety 
* Never break state machine, automate admin authority, or redesign upload pipeline casually 
* Major lifecycle features require: schema design, migration sequencing plan, backward compat analysis 