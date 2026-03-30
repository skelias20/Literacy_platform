# Assessment Engine Reference

## Overview

Two assessment kinds: `initial` (placement) and `periodic` (re-evaluation).
Both kinds share the same `Assessment` model, `AssessmentArtifact` model, and routes.
`initial` assessments are student-triggered; `periodic` are admin-triggered.

---

## Initial Assessment — Multi-Session Flow

### Admin Setup (must happen before any student can take an assessment)

1. Go to `/admin/assessments` → Configuration panel
2. Set `initialSessionCount` (1–5). Default is 1 (single session, preserves old behaviour).
3. For each level (foundational/functional/transitional/advanced):
   - Go to Content Slots panel
   - Select level
   - For each skill (reading, listening, writing, speaking):
     - For each session number (1 to N):
       - Assign a content item from the Content Library
4. **Listening slots require a question bank on the audio before they can be assigned.**
   - Author question banks on the daily tasks page or via the QB builder in the slot panel
5. After all slots are filled, the readiness grid turns green

### taskFormat Derivation

When an `Assessment` row is created, `taskFormat` is derived from the listening slot:

```ts
// Pseudo-code
const slot = await prisma.assessmentDefaultContent.findUnique({
  where: { level_skill_sessionNumber: { level: childLevel, skill: "listening", sessionNumber } }
})
const qbText = slot?.contentItem?.questionBank?.textBody
// Parse JSON → questions[0].type → "mcq" | "msaq" | "fill_blank" | "free_response"
```

This means `taskFormat` is per-session, not global. Sessions can have different formats if their listening content has different question bank types.

### Student Flow

```
Student status = assessment_required
  ↓
GET /api/student/assessment
  → finds open session (isLatest=true, submittedAt=null)
  → if none exists and kind=initial: creates session 1 row
  → loads content from AssessmentDefaultContent slots (level + sessionNumber)
  → strips correct answers from QB before sending
  → returns { assessmentId, sessionNumber, totalSessions, taskFormat, content }
  ↓
Student completes all 4 skills, submits
  ↓
POST /api/student/assessment/submit
  → validates writing word count (30-800)
  → scores structured listening answers against full QB
  → stores artifacts (writing textBody, listening answersJson, audio via fileId)
  → marks assessment submittedAt
  → if sessionNumber < initialSessionCount:
      create next session row (taskFormat derived from next slot)
      Child.status stays assessment_required
      → Student sees amber "take tomorrow" banner, dashboard shows next session
  → if sessionNumber === initialSessionCount:
      Child.status = pending_level_review
      → Student sees green "all sessions complete" screen
```

### Admin Review

`GET /api/admin/assessments` returns assessments where:
- `kind = "initial"` AND `sessionNumber = initialSessionCount` (final session only in review queue)
- `kind = "periodic"` (all periodic)
- Both: `submittedAt != null`, `isLatest = true`, `assignedLevel = null`

`GET /api/admin/assessments/[id]` returns `{ assessment, allSessions }` — admin sees all sessions' artifacts in tabs.

`POST /api/admin/assessments/assign-level` assigns level, sets `Child.status = active` for initial, no status change for periodic.

---

## Periodic Re-evaluation

### Trigger

`POST /api/admin/assessments/trigger-periodic`
```json
{ "scope": "all" }
{ "scope": "level", "level": "foundational" }
```

Creates `Assessment` rows (kind: `periodic`, `isLatest: true`, `submittedAt: null`) for eligible students.
Skips students who already have an open unsubmitted periodic assessment.

### Student Experience

Dashboard banners (in `app/student/page.tsx`, server component with direct Prisma access):

| State | Banner |
|-------|--------|
| Open periodic (not submitted) | Amber "Re-evaluation Required" + "Start Re-evaluation" button |
| Open periodic, previous periodic submitted today | Same banner + "take tomorrow" recommendation |
| Submitted periodic, awaiting admin review | Blue "Re-evaluation Submitted" |
| Next initial session ready | Amber "Next Assessment Session Ready" |
| Next initial session ready, previous submitted today | Same + "take tomorrow" recommendation |

### Time-Aware "Take Tomorrow" Logic

```ts
// In app/student/page.tsx (server component)
const tomorrowStart = new Date(today.getTime() + 86_400_000)
const prevSession = await prisma.assessment.findFirst({
  where: { childId, kind, sessionNumber: openSession.sessionNumber - 1 },
  select: { submittedAt: true }
})
const shouldRecommendTomorrow = prevSession?.submittedAt
  && prevSession.submittedAt >= today
  && prevSession.submittedAt < tomorrowStart
```

---

## Question Bank Architecture

### Storage

Question banks are stored as `ContentItem` records with `type = "questions"` and `textBody` as JSON:

```json
{
  "questions": [
    { "id": "q1", "type": "mcq", "prompt": "...", "options": ["A","B","C"], "correctAnswer": "A" },
    { "id": "q2", "type": "msaq", "prompt": "...", "answerCount": 2, "correctAnswers": ["X","Y"] },
    { "id": "q3", "type": "fill_blank", "prompt": "...", "correctAnswer": "cat" }
  ]
}
```

The question bank `ContentItem` links to its audio via `parentContentItemId`. One audio → one question bank (`@unique` on `parentContentItemId`).

### Correct Answer Stripping

Before sending content to students, correct answers are stripped:

```ts
const stripped = { questions: bank.questions.map(({ correctAnswer, correctAnswers, ...safe }) => safe) }
return { ...item, textBody: JSON.stringify(stripped) }
```

**Correct answers are NEVER sent to the client before submission.**

### Scoring (server-side)

`scoreAnswers(questions, studentAnswers)` in the submit route:
- MCQ: normalise both sides, exact match
- fill_blank: normalise both sides (trim + lowercase), exact match
- MSAQ: count matching answers from correct set (case-insensitive), partial credit

Returns `AnswerEntry[]` stored as `answersJson`.

### Mixed Formats

A single question bank can contain multiple question types (MCQ question followed by MSAQ question, etc.). The format selector in the question bank builder controls which **type the next question will be** — it does not lock the entire bank to one type.

### Assessment vs Daily Task Differences

| | Assessment | Daily Task |
|--|-----------|-----------|
| Submit behaviour | One-shot: submit and lock immediately | Check answers → reveal results → retry up to 3 times |
| Correct answers shown | After submit (on confirmation screen) | After each check attempt |
| Result stored | On first (and only) submit | On each attempt; final stored on task lock |
| Submit button label | "Submit Assessment" | "Check answers" → "Submit task" |

---

## AssessmentConfig Routes

### GET /api/admin/assessments/config
Returns:
```json
{
  "config": { "id": "...", "initialSessionCount": 2, "updatedAt": "..." },
  "completeness": { "foundational": { "reading": 2, "listening": 1, "writing": 2, "speaking": 2 } },
  "missingSlots": [ { "level": "foundational", "skill": "listening", "sessionNumber": 2 } ],
  "isComplete": false
}
```

### PUT /api/admin/assessments/config
```json
{ "initialSessionCount": 3 }
```
Validates that all required slots are filled before increasing the count. Decreasing is always allowed. Returns same shape as GET.

---

## AssessmentDefaultContent Routes

### GET /api/admin/assessments/default-content
Returns `{ slots, availableContent }`.
`availableContent` for listening skill only includes items with a non-archived question bank.

### POST /api/admin/assessments/default-content
```json
{ "level": "foundational", "skill": "listening", "sessionNumber": 1, "contentItemId": "..." }
```
Upserts slot. Server validates: item exists, not archived, skill matches, listening items have QB.

### DELETE /api/admin/assessments/default-content
```json
{ "level": "foundational", "skill": "listening", "sessionNumber": 1 }
```
**Always permitted.** No session count guard. Readiness indicator shows the gap; config save validates at save time.
