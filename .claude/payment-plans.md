# Payment Plans & Subscription Tiers — Future Implementation Guide
## Liberty Library Literacy Platform

> **Status:** Architectural design only. Nothing in this document is implemented yet beyond the base monthly manual subscription (ISSUE-19). Read this before implementing any payment tier, gateway integration, or plan management feature.
>
> **Cross-reference:** `.claude/billing-subscription.md` covers the implemented base subscription system (schema, routes, UI, invariants). This document covers everything that comes after it.

---

## 1. What Is Already Built (the foundation)

Before reading further, understand the current state so nothing is duplicated or broken.

**Implemented (Session XI):**
- `BillingConfig` — single-row admin-configurable table: `cycleDays`, `gracePeriodDays`, `renewalWindowDays`, `monthlyFee`, `currency`
- `Subscription` — append-only history table; one row per billing period per student
- `RenewalPayment` — student-initiated renewal submission; admin approves/rejects manually
- `Child.subscriptionExpiresAt` — denormalized cache of `MAX(Subscription.periodEnd)`
- Access control: `null` = grandfathered (no block); grace period = allow with banner; hard lock = 402 on submissions
- Payment events: `RENEWAL_SUBMITTED`, `RENEWAL_APPROVED`, `RENEWAL_REJECTED` already in `PaymentEvent`
- Audit actions: `RENEWAL_APPROVED`, `RENEWAL_REJECTED`, `SUBSCRIPTION_OVERRIDDEN` already in `AuditAction`

**Key invariant to never break:**
- Billing code never touches `Child.status`
- `Subscription` rows are append-only — never updated after creation
- `Child.subscriptionExpiresAt` must always equal `MAX(Subscription.periodEnd)` for that child — updated in the same transaction as the `Subscription` row

---

## 2. Planned Subscription Tiers

### 2.1 Tier Model

Two tiers are planned: **Standard** and **Premium**.

**Standard** (current tier, all students):
- Full access to the core literacy curriculum
- Reading, Listening, Writing, Speaking tasks and assessments
- Admin-assigned daily tasks and assessments

**Premium** (planned):
- Everything in Standard
- Access to subject-specific and specialised content libraries
- Envisioned library categories:
  - Subject-specific literacy: Science, Social Studies, Mathematics word problems
  - GIS / Geography: Map interpretation, spatial reasoning
  - Aviation English: ICAO standards, aeronautical reading
  - Academic prep: IELTS/TOEFL-style tasks, academic writing conventions
- Premium content items are not visible or accessible to standard-tier students

### 2.2 Where Tier Lives in the Schema

**Preferred approach — tier on `Subscription` row (Option B):**

```prisma
enum SubscriptionTier {
  standard
  premium
}

model Subscription {
  // ... existing fields ...
  tier  SubscriptionTier  @default(standard)
}
```

Rationale: tier is a property of a billing period, not a permanent label on the student. A student can be standard one month and premium the next. The `Subscription` row is the correct place to record this.

**Do NOT put tier on `Child`** unless a future decision explicitly overrides this. Tier on `Child` creates ambiguity when a student's tier changes mid-cycle.

### 2.3 Content Gating

```prisma
model ContentItem {
  // ... existing fields ...
  tier  SubscriptionTier  @default(standard)
}
```

- `standard` content is accessible to all students
- `premium` content is only accessible to students whose active `Subscription` row has `tier = premium`
- Content access check happens in `GET /api/student/content/[fileId]` and when building assessment/task content responses
- Admin content library panel shows a tier badge on each content item
- Assessment slot assignment must validate: if the slot's content is premium, the student must be on a premium subscription at assessment creation time

### 2.4 BillingConfig Extension

```prisma
model BillingConfig {
  // ... existing fields ...
  premiumFee  Decimal?  @db.Decimal(10, 2)   // display value for premium tier
}
```

`premiumFee` is informational only, same as `monthlyFee`. No code enforces the amount paid — admin approves manually.

---

## 3. Payment Gateway Integration

### 3.1 Why It Will Be Needed

The current manual approval flow works for low student volume but does not scale. A payment gateway (Stripe, PayMongo, or equivalent) automates:
- Payment collection
- Subscription period creation
- Failure handling and retry
- Webhook-driven state updates

**Decision:** Gateway integration is deferred until student volume justifies per-transaction fees. The manual flow remains available as a fallback for cash/offline payers even after a gateway is live.

### 3.2 Gateway Candidates

| Gateway | Best fit | Notes |
|---|---|---|
| **Stripe** | If target market is international or USD-primary | Mature API, strong webhook reliability, Stripe Billing handles recurring natively |
| **PayMongo** | If target market is Philippines-based | Local payment methods (GCash, Maya, bank transfer), PHP-denominated, lower friction for local payers |
| **Both** | Hybrid markets | Route to gateway by student location or parent preference |

**Recommendation:** Design gateway integration as a pluggable code path, not tied to a specific provider. Both Stripe and PayMongo return events via webhooks — the internal handler is the same shape regardless of gateway.

### 3.3 Architecture: Gateway Payment Flow

```
Parent pays via gateway (card / GCash / bank)
  → Gateway processes payment
  → Gateway sends webhook to POST /api/webhooks/payment-gateway
  → Route verifies webhook signature
  → Route creates RenewalPayment (status: approved, method: gateway)
  → Route creates Subscription row (same logic as manual approve)
  → Route updates Child.subscriptionExpiresAt
  → Route writes PaymentEvent(GATEWAY_PAYMENT_RECEIVED)
  → 200 OK to gateway (acknowledge receipt)
```

**Key design rule:** The webhook handler must be **idempotent** — gateways retry on non-2xx. Use the gateway's event ID as a deduplication key before creating any rows.

### 3.4 New PaymentMethod Values

The existing `PaymentMethod` enum currently has `receipt_upload` and `transaction_id`. Gateway integration adds:

```prisma
enum PaymentMethod {
  receipt_upload
  transaction_id
  stripe          // card via Stripe
  paymongo_gcash  // GCash via PayMongo
  paymongo_maya   // Maya via PayMongo
  paymongo_bank   // bank transfer via PayMongo
}
```

Add only the methods that are actually integrated. Do not pre-add enum values speculatively.

### 3.5 New PaymentEvent Types

```prisma
enum PaymentEventType {
  // ... existing values ...
  GATEWAY_PAYMENT_RECEIVED    // webhook confirmed a successful charge
  GATEWAY_PAYMENT_FAILED      // webhook reported a failed charge
  GATEWAY_SUBSCRIPTION_CANCELLED  // gateway-side cancellation (if using gateway recurring billing)
}
```

### 3.6 New Route

```
POST /api/webhooks/payment-gateway
```

- Unprotected route (no JWT) — verified by gateway signature header
- Must be excluded from `proxy.ts` route protection
- Must verify the webhook signature before touching the database
- Must be idempotent (check for existing `RenewalPayment` with the same gateway event ID before creating)
- Returns 200 immediately; do not do slow work before acknowledging

### 3.7 Admin Visibility

Gateway-approved renewals appear in `/admin/subscriptions` the same as manually approved ones. The `method` field on `RenewalPayment` distinguishes gateway vs. manual. Admins can still see the full history and override `subscriptionExpiresAt` manually if needed.

---

## 4. Multiple Plan / Pricing Variants

### 4.1 Cycles Other Than Monthly

`BillingConfig.cycleDays` already supports this — set it to 90 for quarterly, 365 for annual. No schema change needed.

**If different students need different cycle lengths simultaneously** (e.g., some on monthly, some on annual), the current single-row `BillingConfig` is insufficient. The right fix is to add a `planId` to `Subscription` and create a `Plan` table:

```prisma
model Plan {
  id            String    @id @default(uuid())
  name          String    // "Monthly Standard", "Annual Premium"
  tier          SubscriptionTier
  cycleDays     Int
  fee           Decimal?  @db.Decimal(10, 2)
  currency      String    @default("USD")
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
}

model Subscription {
  // ... existing fields ...
  planId  String?
  plan    Plan?   @relation(fields: [planId], references: [id])
}
```

**Do not implement this until it is explicitly required.** The current single-config approach is correct for the current usage.

### 4.2 Promotional or Custom Pricing

Admin can already override `subscriptionExpiresAt` per student via `PATCH /api/admin/students/[childId]/subscription`. This handles:
- Promotions (extend expiry manually)
- Goodwill extensions
- Test accounts (set far-future date)

No "discount code" or "promo plan" system is needed at current scale.

### 4.3 Free / Trial Accounts

A student with `subscriptionExpiresAt = null` is treated as grandfathered — no subscription enforcement. This is the correct way to handle:
- Internal test accounts
- Trial students
- Grandfathered students from before billing was introduced

No separate "free plan" model is needed. `null` already means "no expiry check."

---

## 5. Upgrade / Downgrade Between Tiers

When a student moves from Standard to Premium or back:
- The current `Subscription` row is **not modified** (append-only rule)
- The next renewal is submitted as the new tier
- Admin approves the renewal and creates a new `Subscription` row with the new `tier` value
- If using a gateway, the gateway plan change triggers a prorated charge and a new `Subscription` row via webhook

**Admin override path:** Admin can also create a new `Subscription` row directly via a future admin route:
```
POST /api/admin/students/[childId]/subscription/override-tier
```
This creates a new `Subscription` row with the desired tier and updates `subscriptionExpiresAt`. Always in a transaction. Always writes an audit event with `SUBSCRIPTION_OVERRIDDEN`.

---

## 6. Schema Migration Sequence

When any of the above is implemented, follow this order:

1. **Tier on Subscription** — add `SubscriptionTier` enum, add `tier` field to `Subscription`, add `tier` field to `ContentItem`, add `premiumFee` to `BillingConfig`. Migration name: `add_subscription_tier`.
2. **Plan table** (only if multi-cycle plans are needed) — add `Plan` model, add `planId` to `Subscription`. Migration name: `add_subscription_plan`.
3. **Gateway methods** — add new `PaymentMethod` enum values, add new `PaymentEventType` enum values, add webhook route. Migration name: `add_gateway_payment_methods`.

Each migration is independent. Do them in sequence; never combine schema changes from different phases into one migration unless they are logically atomic.

---

## 7. Implementation Order (when the time comes)

This is the recommended sequence. Do not skip ahead.

```
Phase 1 — Tier model
  1. Schema migration: add SubscriptionTier enum + Subscription.tier + ContentItem.tier + BillingConfig.premiumFee
  2. Update admin subscription approval route to accept tier parameter
  3. Add content gating to student content access route
  4. Admin UI: tier badge on content items, tier selector on subscription approve modal
  5. Student UI: show tier label on subscription page

Phase 2 — Gateway integration
  1. Choose gateway (Stripe or PayMongo)
  2. Add new PaymentMethod and PaymentEventType enum values
  3. Implement POST /api/webhooks/payment-gateway (idempotent, signature-verified)
  4. Wire gateway webhook in production (environment variable for signing secret)
  5. Test with gateway sandbox before enabling in production
  6. Keep manual approval flow fully intact — gateway is additive, not a replacement

Phase 3 — Plan table (only if needed)
  1. Schema migration: add Plan model + Subscription.planId
  2. Admin UI: plan management page (create, archive plans)
  3. Subscription approval selects a plan instead of reading BillingConfig directly
  4. BillingConfig becomes a fallback default only
```

---

## 8. Invariants That Must Never Be Broken (extended)

All invariants from `.claude/billing-subscription.md` §10 apply and are not repeated here. Additional invariants for future phases:

- **Never gate content for pre-active students** — tier/subscription checks apply only after `Child.status = active`
- **Never store raw gateway payment credentials** in the database — only gateway event IDs and status
- **Always verify webhook signatures** before touching the database — never trust gateway webhook payloads without verification
- **Gateway webhook handler must be idempotent** — gateways retry; creating duplicate rows is worse than dropping a retry
- **Tier changes always produce a new Subscription row** — never mutate an existing row to change the tier
- **`null` subscriptionExpiresAt is always a valid state** — never force-set it during tier or gateway work
- **Manual renewal flow must remain functional** even when a gateway is live — offline and cash payers must always have a path

---

## 9. Open Decisions (resolve before implementing)

| Decision | Options | Recommendation |
|---|---|---|
| Which gateway first | Stripe vs PayMongo | Decide based on where students are located; design gateway path as provider-agnostic |
| Tier on Subscription vs. Child | Row vs. field | Row (Option B) — already recommended above |
| Proration on tier upgrade mid-cycle | Credit days vs. start fresh | Defer to gateway; for manual flow, admin decides |
| Premium content visibility to standard students | Hidden vs. visible but locked | Hidden is simpler and avoids upsell friction in an education context |
| Free trial length | 7 days / 14 days / 30 days | Use `null` + admin-set expiry; no dedicated trial state needed |
| Multi-currency | Single vs. per-student | Single currency per `BillingConfig` for now; `currency` field is already there for future use |
