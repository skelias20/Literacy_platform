# Billing & Subscription Design
## Liberty Library Literacy Platform

> **Status:** Designed, not yet implemented. This document is the authoritative reference for ISSUE-19 implementation. Read this before touching any billing or subscription code.

---

## 1. Overview

The platform requires a monthly subscription model. Students (via their parents) pay a recurring fee to maintain access. The model is deliberately admin-controlled and manual — no automated billing, no third-party payment gateway at initial launch. All renewals go through admin review, consistent with the existing human-in-the-loop philosophy.

### Design principles carried forward
- Admin is the only entity that finalises financial state changes
- No automated status changes — all transitions are admin-triggered
- Subscription state is **orthogonal to `Child.status`** — the learning lifecycle state machine is never touched by billing code
- Every financial event is logged in `PaymentEvent` (already built in ISSUE-18)
- The schema must accommodate a future third-party payment gateway with zero structural changes — only new code paths

---

## 2. Final Design Decisions (confirmed)

| Decision | Choice | Rationale |
|---|---|---|
| Where subscription state lives | **Hybrid: `Subscription` history table + `Child.subscriptionExpiresAt` cache** | History table for auditability and payment gateway readiness; cache field for fast access checks without joins |
| Renewal submission | **Separate `RenewalPayment` model**, student-initiated (parent uses child's account) | Keeps `Payment` (registration) untouched; renewal has its own routes and admin review page |
| New period start | **From `currentPeriodEnd`** (not from approval date) | Student is not penalised for admin processing delay; early renewal doesn't lose days |
| Cycle & config | **New `BillingConfig` single-row table** | Admin-configurable without deploy; mirrors `AssessmentConfig` pattern |
| Expiry behavior | **Grace period banner → submission lock** | Accounts for admin processing delays; student can still view dashboard and history after expiry |
| Initial `subscriptionExpiresAt` | **Auto-set at registration payment approval** (`approvedAt + cycleDays`) | Least friction; admin can override per-student; fallback to 30 days if no `BillingConfig` yet |
| Pre-active students | **Advisory until `active`, enforced after** | Students mid-placement are not blocked; admin sees a flag |
| Who can renew | **Any student who is not `pending_payment` or `rejected`** | Parent could hit renewal window while child is still in placement |

---

## 3. Schema — New Models

### 3.1 `BillingConfig` (single-row table, same pattern as `AssessmentConfig`)

```prisma
model BillingConfig {
  id                String   @id @default(uuid())
  cycleDays         Int      @default(30)   // subscription period length in days
  gracePeriodDays   Int      @default(7)    // days after expiry before hard lock
  renewalWindowDays Int      @default(7)    // days before expiry when renew button activates
  monthlyFee        Decimal? @db.Decimal(10, 2) // display value shown to student (not enforced)
  currency          String   @default("USD")
  updatedByAdminId  String
  updatedByAdmin    Admin    @relation(fields: [updatedByAdminId], references: [id], onDelete: Restrict)
  updatedAt         DateTime @updatedAt
  createdAt         DateTime @default(now())
}
```

**Rules:**
- Always upsert, never insert a second row
- `monthlyFee` is informational only — no code enforces the amount
- If no row exists when a payment is approved, fallback to `cycleDays = 30`

---

### 3.2 `Subscription` (append-only history)

```prisma
model Subscription {
  id                String    @id @default(uuid())
  childId           String
  child             Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  periodStart       DateTime
  periodEnd         DateTime
  renewalPaymentId  String?   @unique  // null for the first (registration-derived) period
  renewalPayment    RenewalPayment? @relation(fields: [renewalPaymentId], references: [id], onDelete: SetNull)
  createdAt         DateTime  @default(now())

  @@index([childId, periodEnd])
  @@index([periodEnd])
}
```

**Rules:**
- One row per billing period — never updated after creation
- `periodStart` of a renewal = `periodEnd` of the previous period (no gap, no overlap)
- The first row is created when admin approves the registration payment; `periodStart = approvedAt`, `periodEnd = approvedAt + cycleDays`
- `renewalPaymentId` is null for the first (registration-derived) row
- The "active" subscription for a child is the row with `periodEnd = MAX(periodEnd) WHERE childId = X`
- `Child.subscriptionExpiresAt` is a denormalized cache of `MAX(periodEnd)` for that child — always kept in sync when a Subscription row is created

---

### 3.3 `RenewalPayment` (separate from registration `Payment`)

```prisma
enum RenewalPaymentStatus {
  pending
  approved
  rejected
}

model RenewalPayment {
  id            String              @id @default(uuid())
  childId       String
  child         Child               @relation(fields: [childId], references: [id], onDelete: Cascade)
  method        PaymentMethod                          // reuse existing enum
  status        RenewalPaymentStatus @default(pending)
  transactionId String?
  receiptFileId String?             @unique
  receiptFile   File?               @relation("RenewalReceiptFile", fields: [receiptFileId], references: [id], onDelete: SetNull)
  reviewedByAdminId String?
  reviewedByAdmin   Admin?          @relation("RenewalReviewedByAdmin", fields: [reviewedByAdminId], references: [id], onDelete: SetNull)
  reviewedAt        DateTime?
  createdAt         DateTime        @default(now())

  subscription  Subscription?                          // set after approval

  @@index([childId])
  @@index([status])
  @@index([createdAt])
}
```

**Rules:**
- A child can only have one `pending` RenewalPayment at a time — enforced at the API layer (not DB constraint, to allow re-submission after rejection)
- Approved renewal creates a Subscription row and updates `Child.subscriptionExpiresAt`
- Rejected renewal leaves all subscription state unchanged
- `PaymentEventType.RENEWAL_SUBMITTED`, `RENEWAL_APPROVED`, `RENEWAL_REJECTED` are already in the `PaymentEvent` table from ISSUE-18

---

### 3.4 Changes to existing models

**`Child`** — add one field:

```prisma
subscriptionExpiresAt DateTime?   // denormalized cache of latest Subscription.periodEnd
                                  // null = no subscription yet (pre-approval) or grandfathered (admin override)
```

**`Admin`** — add relations:
```prisma
billingConfigs        BillingConfig[]
reviewedRenewals      RenewalPayment[] @relation("RenewalReviewedByAdmin")
```

**`File`** — add relation:
```prisma
renewalReceiptFor     RenewalPayment? @relation("RenewalReceiptFile")
```

**`Child`** — add relations:
```prisma
subscriptions         Subscription[]
renewalPayments       RenewalPayment[]
```

---

## 4. Access Control Logic

This logic runs in the student-facing routes. It does NOT modify `Child.status`.

```
function getAccessState(child):
  if child.status is pending_payment or rejected:
    → block (existing logic, unchanged)
  
  if child.archivedAt is set:
    → block (existing logic, unchanged)
  
  if child.subscriptionExpiresAt is null:
    → allow (grandfathered / pre-billing / admin override)
  
  now = current timestamp
  expiresAt = child.subscriptionExpiresAt
  gracePeriodDays = BillingConfig.gracePeriodDays (default 7)
  hardLockAt = expiresAt + gracePeriodDays

  if now <= expiresAt:
    → allow (active subscription)
  
  if now <= hardLockAt:
    → allow with GRACE_PERIOD banner (submission still works)
  
  if now > hardLockAt:
    → if child.status is active:
        block submission (task submit, assessment submit return 402)
        allow read-only dashboard access
      if child.status is not active (pre-active):
        advisory only — do not block, flag in admin student list
```

**Banner states (student dashboard):**
- `null` subscriptionExpiresAt → no subscription banner
- Active, more than `renewalWindowDays` away → no banner
- Active, within `renewalWindowDays` → amber "Your subscription renews on [date]" + Renew button
- Grace period → amber "Your subscription expired on [date]. Please renew to avoid losing access." + Renew button
- Hard locked → red "Your subscription has expired. Renew to continue." + Renew button (submission routes return 402)

---

## 5. New Routes

### Student routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/student/subscription` | Returns current subscription period, days remaining, fee from BillingConfig, pending renewal status |
| `POST` | `/api/student/subscription/renew` | Submit renewal payment (method + receiptFileId or transactionId). Creates `RenewalPayment` + `PaymentEvent(RENEWAL_SUBMITTED)`. Blocked if a `pending` RenewalPayment already exists. Blocked if status is `pending_payment` or `rejected`. |

### Admin routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/subscriptions` | List RenewalPayments, filterable by status (pending/approved/rejected) |
| `POST` | `/api/admin/subscriptions/[id]/approve` | Approve RenewalPayment → creates Subscription row (`periodStart = prev.periodEnd`, `periodEnd = periodStart + cycleDays`) → updates `Child.subscriptionExpiresAt` → writes `PaymentEvent(RENEWAL_APPROVED)` |
| `POST` | `/api/admin/subscriptions/[id]/reject` | Reject RenewalPayment → writes `PaymentEvent(RENEWAL_REJECTED)` |
| `GET` | `/api/admin/billing-config` | Read BillingConfig |
| `PUT` | `/api/admin/billing-config` | Upsert BillingConfig (cycleDays, gracePeriodDays, renewalWindowDays, monthlyFee, currency) |
| `PATCH` | `/api/admin/students/[childId]/subscription` | Admin override: set `subscriptionExpiresAt` directly per student (for grandfathering, corrections, manual extensions) |

**Key rule on approve route:** Before creating the new Subscription row, the route reads the child's current latest Subscription to get `periodEnd`. New `periodStart = current.periodEnd`. If no Subscription exists yet (edge case: first renewal before any Subscription row), use `approvedAt` as `periodStart`.

### Modified existing routes

**`POST /api/admin/payments/[id]/approve`** — add after existing logic:
- Read `BillingConfig` (fallback `cycleDays = 30`)
- Create first `Subscription` row: `periodStart = now`, `periodEnd = now + cycleDays`
- Update `Child.subscriptionExpiresAt = periodEnd`

---

## 6. UI Pages

### Student: `/student/subscription`

```
Subscription
─────────────────────────────────────────────────────
Current plan: Standard
Monthly fee: $XX.XX

Status: Active
Expires: April 30, 2026 (28 days remaining)

[Renew]  ← disabled until within renewalWindowDays
         ← enabled within renewalWindowDays or during grace

─────────────────────────────────────────────────────
  [if pending renewal exists]
  Renewal submitted — awaiting admin review.
```

**Renew flow:**
1. Student clicks Renew → navigates to `/student/subscription/renew`
2. Page shows the fee and payment instructions
3. Student selects method (receipt upload or transaction ID)
4. If receipt upload: uses existing presign → R2 PUT → confirm flow, then submits `receiptFileId`
5. Submits → `POST /api/student/subscription/renew`
6. Confirmation: "Renewal submitted. Your access continues until [current expiry + gracePeriodDays]."

**Renew button activation:** enabled when `daysRemaining <= renewalWindowDays` OR subscription is already expired (grace or hard lock).

---

### Admin: `/admin/subscriptions`

```
Subscriptions
─────────────────────────────────────────────────────
[Pending (3)] [Approved] [Rejected]

─── Pending Renewals ───────────────────────────────
[Student Name] (Grade X)
  Parent: ... | Email: ... | Phone: ...
  Method: [View receipt] | Tx: ...
  Submitted: [date]
  Current expiry: [date]  ← show so admin can see urgency
  New period would be: [currentExpiry] → [currentExpiry + cycleDays]
  [Approve] [Reject]

─── Billing Config ─────────────────────────────────
  Cycle length: 30 days
  Grace period: 7 days
  Renewal window: 7 days
  Monthly fee: $XX.XX
  [Edit]
```

**Link from main admin dashboard:** `/admin/subscriptions` with a pending count badge, same pattern as payments.

**Link from student detail panel:** show subscription status, current expiry, "Override expiry" button.

---

## 7. Migration Plan

### Step 1 — Schema migration
New models: `BillingConfig`, `Subscription`, `RenewalPayment`.
New enum: `RenewalPaymentStatus`.
New field on `Child`: `subscriptionExpiresAt DateTime?`.
New relations on `Admin`, `File`, `Child`.

Migration name: `add_billing_subscription`

### Step 2 — Data migration (inline SQL or seed script)

For all `Child` rows where `status NOT IN ('pending_payment', 'rejected')`:
- Lookup their `Payment.reviewedAt` (the registration approval timestamp)
- Create one `Subscription` row: `periodStart = reviewedAt`, `periodEnd = reviewedAt + 30 days`
- Set `Child.subscriptionExpiresAt = periodEnd`

> **Note:** Current students are test accounts. If `reviewedAt` is null for some (data gap from before auth was wired on approve route), use `Payment.createdAt` as fallback.

### Step 3 — Route updates
- `POST /api/admin/payments/[id]/approve` — add Subscription creation + `subscriptionExpiresAt` update
- All student submission routes — add access control check (graceful, check field before expensive DB reads)

### Step 4 — UI
- Add subscription banner logic to student dashboard
- Build `/student/subscription` and `/student/subscription/renew`
- Build `/admin/subscriptions` page
- Add Billing Config section to admin config panel
- Add subscription status to student detail panel

---

## 8. `AuditAction` enum additions needed

```prisma
RENEWAL_APPROVED
RENEWAL_REJECTED
SUBSCRIPTION_OVERRIDDEN   // admin manually sets subscriptionExpiresAt
```

These go into the existing `AuditAction` enum with the next schema migration.

---

## 9. Future: Premium Accounts

**This section documents planned premium tier architecture. Do not implement until explicitly requested.**

### Concept

A premium subscription tier gives students access to subject-specific or specialised content libraries beyond the core literacy curriculum. Examples envisioned:

- **Subject-specific literacy**: Science reading passages, Social Studies texts, Mathematics word problems
- **GIS / Geography**: Map interpretation, spatial reasoning, geography comprehension
- **Aviation English**: Technical reading, ICAO communication standards, aeronautical passages
- **Academic prep**: IELTS/TOEFL-style tasks, academic writing conventions

### Schema preparation (design now, implement later)

The `BillingConfig` table is already named for `Standard` tier. When premium launches:

**Option A — Tier on `Child`:**
```prisma
enum SubscriptionTier { standard, premium }
Child.subscriptionTier SubscriptionTier @default(standard)
```

**Option B — Tier on `Subscription` row:**
```prisma
Subscription.tier SubscriptionTier @default(standard)
```

Option B is preferred — the tier is a property of a specific billing period, not the child permanently. A child could be standard one month and premium the next. The `Subscription` row captures the exact tier for that period.

**Content gating:**
- `ContentItem` would gain a `tier SubscriptionTier @default(standard)` field
- Premium content items are not visible or accessible to standard-tier students
- Admin content library panel shows tier badge on each content item
- Assessment default slots would only allow premium content for premium students (slot assignment validated against student tier at assessment creation)

**Billing config expansion:**
```prisma
BillingConfig.premiumFee Decimal?   // display value for premium tier
```

**Payment gateway readiness:**
When a gateway (Stripe, PayMongo, etc.) is integrated:
- Webhook creates a `Subscription` row with `tier` from the gateway plan metadata
- `Child.subscriptionExpiresAt` and `Child.subscriptionTier` (or whichever model carries tier) updated atomically
- Manual `RenewalPayment` flow remains available as a fallback for cash/offline payers
- `PaymentEvent` table already has `RENEWAL_SUBMITTED`, `RENEWAL_APPROVED` — add `GATEWAY_PAYMENT_RECEIVED`, `GATEWAY_PAYMENT_FAILED` event types

**Admin UI extension:**
- Subscriptions page gains a tier filter
- Student detail panel shows tier + upgrade/downgrade button
- Content library gains tier filter column

### Key architectural guarantee

The subscription system is designed so that adding a premium tier requires:
- One new enum value
- One new field on `ContentItem`
- One new field on `Subscription`
- New admin UI controls
- **No changes to the state machine, assessment engine, or upload pipeline**

---

## 10. Invariants — Never Violate

- Never set `Child.status` from any billing or subscription code
- Never create two `Subscription` rows with overlapping `(childId, periodStart, periodEnd)` ranges
- Never update a `Subscription` row after creation — append only
- Never approve a `RenewalPayment` without creating a corresponding `Subscription` row in the same transaction
- `Child.subscriptionExpiresAt` must always equal `MAX(Subscription.periodEnd)` for that child — always update both in the same transaction
- `null` subscriptionExpiresAt = grandfathered / no expiry — treat as valid indefinitely
- Billing routes never block students in `pending_payment` or `rejected` — those are already blocked by existing auth/status logic
- Access control checks subscription only for `active` students — pre-active students are flagged to admin but not blocked
- A child may only have one `pending` RenewalPayment at a time — reject duplicate submissions at the route layer
