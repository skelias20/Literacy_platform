# Known Issues — Session VI

**Session V fixes applied:** ISSUE-01 through ISSUE-09, ISSUE-11/24, ISSUE-14, ISSUE-15, ISSUE-17, plus payment reject route auth/schema bugs.

**Session VI fixes applied:** Periodic "check back soon" bug (slot session number), admin artifact source content access, admin list shows session 1 immediately on submission, session counter on student dashboard, slot replacement UI, assign-level only on last tab, assign-level uses active session ID.

Remaining items below are either pending verification, planned features, or require product decisions.

This file is now organized into three categories:

1. **Critical Bugs / Current Implementation Issues** — concrete bugs, regressions, and behavior mismatches that should be fixed before adding new features.
2. **System Constraints / Workflow Rules** — important product and system behavior rules that must be enforced to avoid future bugs or inconsistent logic.
3. **Future Features / Architecture Decisions** — not necessarily bugs, but important missing capabilities, schema decisions, and scalability concerns that must be planned deliberately.

---

## How to use this file

For each item:
1. Read the description and potential solution
2. Find the relevant files or routes
3. Fix the issue with the smallest correct change
4. Test the exact affected workflow end-to-end
5. After fixing, delete the item from this file and commit

---

## ISSUE-10: Periodic assessment status behavior must be verified

**Area:** Periodic assessment flow

**Problem:**
The current status behavior for periodic assessment still needs verification. The concern is whether periodic assessment submission or admin review is accidentally changing fields that should remain stable, especially student activation-related fields.

**Potential solution:**
Run an end-to-end test:
1. Create an active student
2. Trigger a periodic assessment
3. Submit it
4. Assign/update level
5. Verify child status before and after
6. Verify only intended fields changed

**Priority:** Medium — may overlap with ISSUE-02 but still needs explicit end-to-end verification.

---

# 2. System Constraints / Workflow Rules

## ISSUE-12: Initial and periodic assessments likely need separate implementation paths

**Area:** Assessment domain logic

**Problem:**
Initial and periodic assessments now differ significantly. Trying to force both into one generic path may create repeated conflicts.

**Note:** ISSUE-11 grade mapping is now implemented (Session V). Monitor for further friction as features are added.

**Priority:** Architecture consideration — monitor.

---


## ISSUE-17: Limit accepted registration grade to 1–8

**Area:** Registration validation

**Problem:**
If grade is going to drive initial assessment content selection, the system must enforce a strict supported grade range. Allowing other grade values would break content mapping assumptions.

**Potential solution:**
Enforce on both frontend and backend:
- Accepted grades: 1, 2, 3, 4, 5, 6, 7, 8
- Show clear validation message if value is outside range

**Priority:** Medium — important supporting rule for initial assessment architecture.

---

# 3. Future Features / Architecture Decisions

## ISSUE-18: Payment event table is needed

**Area:** Payments / finance / audit trail

**Problem:**
A dedicated payment event table is needed to track payment-related activity. This will be useful for: financial reporting, reconciliation, refund windows, SLA tracking, dispute resolution, and payment analytics.

**Potential solution:**
Introduce a `PaymentEvent`-style table with fields such as:
- `id`
- `childId` or `registrationId`
- `eventType`
- `statusBefore`
- `statusAfter`
- `amount`
- `currency`
- `paymentMethod`
- `reference`
- `notes`
- `createdAt`
- `createdBy`

Keep it append-only where possible.

**Priority:** Planned architecture item.

---

## ISSUE-19: Monthly fee / subscription renewal model is not designed yet

**Area:** Billing / product lifecycle

**Problem:**
The system currently handles registration/payment approval, but long-term monthly subscription renewal logic has not been designed.

**Potential solution:**
Decide:
- Renewal cycle
- Grace period
- Expired account behavior
- Renewal reminder flow
- Payment failure handling
- Whether access locks immediately or after a buffer period

This should be designed before production monetization.

**Priority:** Planned business logic item.

---

## ISSUE-20: Optional video description URL for task guidance

**Area:** Content schema / student task UX

**Problem:**
Tasks may need an optional instructional video link explaining how the student should do the task. This should be attached to content, but remain optional.

**Potential solution:**
Add a nullable field such as `instructionVideoUrl` or similar to the relevant content/task model. Render it only when present.

**Priority:** Planned content enhancement.

---

## ISSUE-21: Evaluate whether current JWT auth is enough for multi-server scalability

**Area:** Authentication / production readiness

**Problem:**
There is an open architecture question about whether the current JWT-based auth approach will transfer cleanly across servers and remain sufficient for a scalable production setup.

**Potential solution:**
Review:
- Token signing/verification consistency across servers
- Secret management
- Token revocation strategy
- Refresh-token strategy
- Logout invalidation behavior
- Whether stateful session storage is needed for certain admin or child workflows

JWT alone may be enough for some deployments, but not automatically for all production requirements.

**Priority:** Planned architecture review.

---

## ISSUE-22: User profile edit request workflow should go through admin

**Area:** Profile management / permissions

**Problem:**
Users should not directly edit important profile data themselves, especially since the end users are children. Instead, they should submit a form requesting minor changes to names, contacts, or other allowed fields, and the admin should review and apply or approve those changes.

**Potential solution:**
Create a controlled edit-request workflow:
- User submits requested changes
- System stores a pending request
- Admin reviews and approves/rejects
- Changes are applied only after admin action
- Keep an audit trail of requested and approved values

**Priority:** Planned workflow feature.

---

## ISSUE-23: Per-student periodic trigger is not yet built

**Area:** Admin student management

**Problem:**
Architecture is defined for a per-student periodic trigger, but the implementation is not built yet.

**Potential solution:**
On `/admin/students/[childId]`, add a button that calls:

```
POST /api/admin/assessments/trigger-periodic
{ scope: "student", childId }
```

Add a discriminated-union schema case such as:

```ts
z.object({
  scope: z.literal("student"),
  childId: IdSchema
})
```

**Priority:** Planned admin workflow enhancement.

---

## ISSUE-24: Confirm initial assessment level selection for session 1 is an intentional product decision

**Area:** Assessment slot lookup

**Problem:**
The student assessment GET route currently uses:

```ts
child.level ?? "foundational"
```

for initial assessment slot lookup. This means students without an assigned level all receive foundational content by default.

This may be acceptable as a deliberate baseline strategy, but it must be explicitly confirmed. It may conflict with the newer grade-based mapping proposal (see ISSUE-11).

**Potential solution:**
Choose one and document it clearly:
1. All students receive foundational initial assessment content, or
2. Grade determines initial assessment content band, or
3. Another temporary assessment-lookup rule

Do not leave this as an accidental implementation detail.

**Priority:** Planned product decision requiring confirmation.

---

