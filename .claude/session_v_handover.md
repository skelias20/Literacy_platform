# Session V Handover — Bugs Found During Testing

**Date:** 2026-03-29
**Status:** Session V fixes applied. Post-fix testing revealed new bugs and design gaps. Start Session VI by working through this file top to bottom.

---

## What Was Fixed in Session V

| Issue | File(s) |
|-------|---------|
| ISSUE-01 | Removed `void deleteR2Object` dead code from content route |
| ISSUE-02 | Confirmed already fixed |
| ISSUE-03 | Cleaned up redundant body construction in assessment page submit() |
| ISSUE-04 | Daily task GET: question bank items now included in response (removed type=questions filter) |
| ISSUE-05 | Register page: removed forbidden Content-Length header from R2 PUT. Payments route: replaced raw jwt.verify with verifyAdminJwt, added runtime. Reject route: added auth, fixed reviewNote field, fixed hardcoded adminId. |
| ISSUE-06 | Assessment GET: re-derives taskFormat if existing row is free_response but slot now has QB |
| ISSUE-07 | Assessment page: content_not_configured now shows inline message instead of silent redirect |
| ISSUE-08 | Admin assessments page: savedSessionCount separate from configSessionCount for readiness grid |
| ISSUE-09 | Admin assessments page: qbFormat reset to mcq before loadQb in openQbForSlot |
| ISSUE-11/24 | Assessment GET: gradeToLevel() implemented — grade 1-2→foundational, 3-4→functional, 5-6→transitional, 7-8→advanced |
| ISSUE-14 | Daily tasks: past-date prevention in UI (min attribute) and backend (400 rejection) |
| ISSUE-15 | Student daily task GET: server-side date check — only today's tasks accessible unless already completed |
| ISSUE-17 | Confirmed already implemented |

---

## Bugs Found During Post-Fix Testing (Session VI Priority)

---

### BUG-A: 403 on PDF content in assessment (CRITICAL)

**Symptom:** Clicking a PDF content item in the initial assessment returns a 403 error. Affects both old and new students.

**Root cause:** The file serving route `/api/student/content/[fileId]` almost certainly checks `child.status === "active"`. Students taking the initial assessment are in `assessment_required` status, so they are rejected.

**Fix:**
- Read `app/api/student/content/[fileId]/route.ts`
- Change the status guard to allow both `assessment_required` and `active` students
- Verify audio files work the same way (audio files served via `assetUrl` may hit the same route)

**Priority: Critical — assessment is broken for reading/listening content that uses file assets.**

---

### BUG-B: Previously registered students lose content after grade-mapping change (CRITICAL REGRESSION)

**Symptom:** Students who registered BEFORE the Session V grade-mapping change cannot find listening audio in their assessment. The question bank appears (because it is derived from the slot), but the audio content item is missing.

**Root cause:** Before Session V, content was loaded using `child.level ?? "foundational"` as the level filter. After Session V, it uses `gradeToLevel(child.grade)`. Old students may have grade values that map to a different level than `foundational` (e.g., grade 5 → transitional). If the admin only configured slots for foundational, the transitional slot lookup finds nothing.

**The specific mechanism:** The assessment GET route loads slots using `levelFilter`. Old assessment rows existed and were found, so the creation branch was skipped. But the content loading now uses the new grade-mapped `levelFilter` — fetching from slots that may not exist.

**Fix options (choose one):**

Option 1 — Preferred: Add a `lookupLevel` field to the `Assessment` row. Store `gradeToLevel(child.grade)` at row creation time. Use that stored value for all subsequent content loads for that assessment. This is the cleanest and most correct solution but requires a schema migration.

Option 2 — Simpler interim fix: If `slots.length === 0` for the grade-mapped level, fall back to checking the `foundational` level slots. This keeps old students working while the admin catches up with configuring all grade-mapped slots. Document this fallback prominently.

**Priority: Critical — breaks assessment for any student whose grade doesn't map to foundational.**

---

### BUG-C: `content_not_configured` only fires when ALL slots are empty (HIGH)

**Symptom:** If reading/writing/speaking slots are configured but the listening slot is empty for a student's level, the assessment page loads. The student sees three sections with content and one empty section — and can still attempt to "respond" to it with nothing there.

**Root cause:** The assessment GET route checks `if (slots.length === 0)` to decide whether to block. This passes if any slot exists. It should check that all four required skills have a slot.

**Fix:**
In `app/api/student/assessment/route.ts`, after loading slots, verify all four skills are covered:

```ts
const REQUIRED_SKILLS = ["reading", "listening", "writing", "speaking"] as const;
const configuredSkills = new Set(slots.map((s) => s.skill));
const missingSkills = REQUIRED_SKILLS.filter((sk) => !configuredSkills.has(sk));

if (missingSkills.length > 0) {
  return NextResponse.json({
    blocked: true,
    status: child.status,
    reason: "content_not_configured",
    message: "Your assessment is being prepared. Please check back soon.",
  }, { status: 409 });
}
```

**Priority: High — students can submit incomplete assessments with no content for some skills.**

---

### BUG-D: Slot readiness grid counts hidden sessions (MEDIUM)

**Symptom:** Admin sets session count to 2, configures 2 sessions, then reduces count back to 1. The readiness grid shows `2/1` — two slots configured but only 1 required. After removing content from session 1, it shows `1/1` because session 2 content (hidden from UI) is still counted.

**Root cause:** The completeness query in the assessments config route counts ALL `AssessmentDefaultContent` rows per level/skill regardless of `sessionNumber`. It does not filter by `sessionNumber <= initialSessionCount`.

**Fix:**
In `app/api/admin/assessments/config/route.ts`, find the completeness query and add a `sessionNumber` filter:

```ts
// Current — counts all sessions
AssessmentDefaultContent.count({ where: { level, skill } })

// Fixed — counts only required sessions
AssessmentDefaultContent.count({ where: { level, skill, sessionNumber: { lte: initialSessionCount } } })
```

Read that route file first to see the exact query shape before editing.

**Priority: Medium — misleading UI but no data corruption.**

---

## Design Decisions Needed Before Implementing Fixes

---

### DESIGN-1: Live content changes affecting in-progress assessments

**Problem:** The assessment GET route fetches content live from the slot configuration every time. If the admin swaps a content item while a student is mid-assessment, the student's final submission will be evaluated against different content than what they saw. When the admin reviews artifacts, they cannot know which specific content the student was responding to.

**User's concern (exact):** "Once a student opens the assessment page, the changes made to the admin shouldn't apply unless he refreshes, meaning he will be evaluated based on the content he saw and respond to. I hope the current submit button sends the assessment artifact along with the content helping to identify to which content the student responded. If not we need to implement this so that the admin knows to what content the student responded."

**Current state of submit:** `AssessmentArtifact` stores the student's response (textBody, fileId, answersJson) per skill — but does NOT store which `contentItemId` the student was shown.

**Decision needed:**
Option A — Store `contentItemIds` in the Assessment row at the moment the student first loads the page (startedAt). Lock that set for the life of the session. Admin changes to slots after `startedAt` are ignored for that student's current session.
- Requires: adding a `contentItemIds Json?` or a new junction table `AssessmentSessionContent` to the schema.
- Requires: a migration.

Option B — Store `contentItemId` on each `AssessmentArtifact` row. When the student submits, include the content they saw in the artifact. Admin can see "submitted in response to: [content title]" during review.
- Simpler schema change (one nullable field on `AssessmentArtifact`).
- Does not prevent live changes from affecting what the student sees during the session.

Option C — Accept live changes as admin-controlled behavior (current state). Document the operational rule: "Do not modify assessment content while students have active sessions."
- No schema change needed.
- Relies on admin discipline.

**Recommendation:** Option B is the best balance — it gives the admin review auditability without complex locking logic. Option A is ideal long-term but needs careful planning.

**This affects both initial and periodic assessments.**

---

### DESIGN-2: Replace-not-clear enforcement for initial assessment slots (ISSUE-13, still open)

**Problem:** Admin can currently clear a slot entirely, leaving a level without content for a skill. Since students can register at any time, an empty slot means new students of that grade band get `content_not_configured`.

**Decision needed:**
- Should the backend reject a slot-clear request if the slot is for the initial assessment baseline?
- OR should the admin UI hide/disable the clear action for initial slots?
- OR is admin discipline sufficient with a strong warning?

**Implementation when decided:**
In `app/api/admin/assessments/default-content/route.ts` (the slot assignment PUT route), add a guard: if the request would leave a slot empty (`contentItemId: null`) and the session number is within `initialSessionCount`, reject with a 409 and message: "Initial assessment slots cannot be left empty. Assign replacement content instead."

---

## Files to Read at Start of Session VI

Run these before touching any code:

```bash
# Check the file serving route for BUG-A
cat app/api/student/content/[fileId]/route.ts

# Check the assessments config route for BUG-D
cat app/api/admin/assessments/config/route.ts

# Check the assessment GET route for BUG-B and BUG-C (already read, but refresh)
cat app/api/student/assessment/route.ts
```

---

## Session VI Work Order

1. **BUG-A** — Fix status guard in student content file serving route (15 min)
2. **BUG-B** — Fix grade-mapping regression for previously registered students (30 min, discuss with user first)
3. **BUG-C** — Add per-skill slot completeness check in assessment GET (15 min)
4. **BUG-D** — Filter completeness query by sessionNumber in config route (15 min)
5. **DESIGN-1** — Discuss and confirm option for content snapshotting, then implement (60+ min if Option B)
6. **DESIGN-2** — Implement replace-not-clear for initial slots once confirmed (20 min)
7. **ISSUE-16** — Admin daily task delete (if submissions = 0 allow, else block) — still pending
8. **ISSUE-23** — Per-student periodic trigger button — still pending

---

## Known Pre-existing TypeScript Errors (Not Introduced by Session V)

- `prisma/seed.ts` — references `isAssessmentDefault` which was removed from schema
- `worker/src/index.ts` — missing Cloudflare Worker type definitions (R2Bucket, Queue, etc.)

These are pre-existing and do not affect the Next.js app runtime.

---

## State Machine Integrity Check (Confirmed OK)

- `assign-level` correctly only sets `status: "active"` for initial assessments, not periodic ✓
- Periodic assessment does not change `Child.status` ✓
- Flow 4 periodic assessment content loads correctly from assigned level ✓
