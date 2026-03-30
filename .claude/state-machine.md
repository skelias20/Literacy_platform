# Student Status State Machine

## Status Flow

```
pending_payment
    ↓  (admin approves payment)
approved_pending_login
    ↓  (admin generates credentials + student logs in)
assessment_required
    ↓  (student completes ALL initial assessment sessions)
pending_level_review
    ↓  (admin assigns level)
active
```

## Rejected Status

`rejected` is a terminal state from `pending_payment`. Payment was rejected by admin. Student cannot proceed.

## Critical Rules

- **This flow is immutable.** No step can be skipped or automated.
- **Admin is the only entity that triggers transitions.** Students never directly cause a status change except by submitting assessments (which moves them to `pending_level_review` only after all sessions).
- **Periodic re-evaluation NEVER changes status.** A student in `active` stays `active` throughout the entire periodic cycle.
- **`archivedAt` is orthogonal to status.** Setting `archivedAt` does not change the status machine. Archived students are hidden from lists but their status is preserved. Login is blocked for archived students before status checks.

## Transition Table

| From | To | Trigger | Route |
|------|----|---------|-------|
| `pending_payment` | `approved_pending_login` | Admin approves payment | POST /api/admin/payments/[id]/approve |
| `pending_payment` | `rejected` | Admin rejects payment | POST /api/admin/payments/[id]/reject |
| `approved_pending_login` | `assessment_required` | Admin creates credentials (student can now log in) | POST /api/admin/approved-users/[id]/create-credentials |
| `assessment_required` | `assessment_required` | Student submits non-final initial session | POST /api/student/assessment/submit (sessionNumber < initialSessionCount) |
| `assessment_required` | `pending_level_review` | Student submits final initial session | POST /api/student/assessment/submit (sessionNumber === initialSessionCount) |
| `pending_level_review` | `active` | Admin assigns level | POST /api/admin/assessments/assign-level |
| `active` | `active` | Admin triggers periodic assessment | POST /api/admin/assessments/trigger-periodic |
| `active` | `active` | Student submits periodic assessment | POST /api/student/assessment/submit (kind=periodic) |

## Assessment Kinds and Status

| Kind | Status when started | Status effect on submit | Admin action |
|------|--------------------|-----------------------|--------------|
| `initial` (not last session) | `assessment_required` | stays `assessment_required` | — |
| `initial` (last session) | `assessment_required` | → `pending_level_review` | assign level → `active` |
| `periodic` | `active` | stays `active` | update level (optional) → stays `active` |

## Archive Behaviour

`archivedAt` is a soft delete — it does not affect the status machine.

- Student login blocks archived accounts before status checks: `if (child.archivedAt) return 401`
- Admin student list hides archived by default — `showArchived=true` reveals them
- Archive does not cascade delete anything
- Unarchiving simply sets `archivedAt = null`
- An archived student in `active` status is still `active` in the schema — they just cannot log in

## Multi-Session Assessment Context

With `initialSessionCount > 1`, the student may visit `/student/assessment` multiple times while staying in `assessment_required`. The dashboard shows different banners:

1. **First visit**: "Start Initial Assessment"  
2. **Between sessions (not submitted today)**: "Next Assessment Session Ready" — button present
3. **Between sessions (submitted today)**: Same banner + "take it tomorrow" advisory note
4. **All sessions complete**: Student is now in `pending_level_review`
5. **Level assigned**: Student is now `active`, no assessment banners
