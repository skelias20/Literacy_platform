# API Routes Reference

## Conventions

- All routes: `export const runtime = "nodejs"`
- All routes use `parseBody(Schema, await req.json().catch(() => null), "context")` for validation
- All routes use `verifyAdminJwt` or `verifyStudentJwt` from `lib/auth.ts`
- All error responses: `NextResponse.json({ error: "message" }, { status: N })`
- All success responses include `ok: true` or the resource directly
- BigInt fields (File.byteSize) must be `.toString()` before JSON response

---

## Student Routes

### GET /api/student/assessment
Auth: `student_token`  
Returns content for the student's current open assessment session.
```
Response: {
  assessmentId, sessionNumber, totalSessions, taskFormat,
  content: ContentItem[]  // listening QB has correctAnswers stripped
}
Blocked: { blocked: true, status, reason? }  // 409
```
Creates session 1 row if none exists (initial only). Periodic rows are created by admin trigger.
Returns `content_not_configured` if slots are empty for this level+sessionNumber.

### POST /api/student/assessment/submit
Auth: `student_token`
```
Body: { assessmentId, responses?: { listening?, writing? }, answers?: Record<string, string|string[]> }
Response: { ok: true, isLastSession, nextSessionNumber, answersJson? }
```
Validates writing word count (30–800). Scores structured listening. Creates next session row if not last. Sets `pending_level_review` if last initial session.

### GET /api/student/daily-tasks/[taskId]
Auth: `student_token`
Returns task + content + existing submission state.

### POST /api/student/daily-tasks/[taskId]/submit
Auth: `student_token`
Three-retry structured listening (daily tasks only — not assessments).

### POST /api/student/daily-tasks/[taskId]/upload-audio
Auth: `student_token`
Presigns audio upload for daily tasks.

---

## Admin Assessment Routes

### GET /api/admin/assessments
Auth: `admin_token`  
Query: `?kind=initial|periodic|all`
```
Response: {
  assessments: Row[],  // initial: sessionNumber=initialSessionCount only; periodic: all
  pendingPeriodicCount  // triggered but not yet submitted
}
```

### GET /api/admin/assessments/[id]
Auth: `admin_token`
```
Response: { assessment: Assessment & { child, artifacts }, allSessions: SessionDetail[] }
```
`allSessions` is ordered by `sessionNumber` ascending — admin sees full picture.

### POST /api/admin/assessments/assign-level
Auth: `admin_token`
```
Body: { assessmentId, level: LiteracyLevel }
```
Sets `Assessment.assignedLevel`. For initial: sets `Child.status = active`. For periodic: no status change, updates `Child.level`.

### POST /api/admin/assessments/trigger-periodic
Auth: `admin_token`
```
Body: { scope: "all" } | { scope: "level", level: LiteracyLevel }
Response: { ok, triggered, skipped, message }
```
Creates periodic `Assessment` rows. Skips students with an open periodic. Writes `PERIODIC_TRIGGERED` audit log.

### GET/PUT /api/admin/assessments/config
GET: Returns `{ config, completeness, missingSlots, isComplete }`  
PUT: `{ initialSessionCount }` — validates all required slots filled before increasing count.

### GET/POST/DELETE /api/admin/assessments/default-content
GET: Returns `{ slots, availableContent }` — listening content filtered to items with QB only.  
POST: `{ level, skill, sessionNumber, contentItemId }` — upserts slot.  
DELETE: `{ level, skill, sessionNumber }` — always permitted, no count guard.

---

## Admin Content Routes

### GET /api/admin/content
Auth: `admin_token`  
Query: `?skill=&level=&includeDeleted=true`
```
Response: { items: ContentItem[] }  // includes assessmentDefaultSlots[], byteSize as string
```
Never returns `type = "questions"` items (question banks are internal).

### POST /api/admin/content
Auth: `admin_token`
```
Body: { title, description?, skill, level?, type, textBody?, fileId?, mimeType? }
```
Validates skill/type constraint. Requires `fileId` for file-based types.
**`isAssessmentDefault` is NOT a valid field here — it was removed.**

### PATCH /api/admin/content
Auth: `admin_token`
```
Body: { id, title?, description?, level? }
```
Edits non-structural fields only. Cannot change skill or type.

### DELETE /api/admin/content
Auth: `admin_token`
```
Body: { id, force?: boolean }
```
Soft delete. Returns warning if item is in assessment slots or future daily tasks. Force=true bypasses warning.

### GET/PUT /api/admin/content/[id]/question-bank
GET: Returns `{ questionBank: { id, questions[] } | null }`  
PUT: `{ taskFormat: "mcq"|"msaq"|"fill_blank", questions: Question[] }`
Creates or updates question bank ContentItem linked to audio via `parentContentItemId`.
**`isAssessmentDefault` is NOT included in the create call.**

---

## Upload Routes

### POST /api/upload/presign
Auth: context-aware (`student_token` or `admin_token` based on `context` field)
```
Body: { context, mimeType, byteSize, originalName, ...context-specific }
Response: { presignedUrl, fileId }
```
Creates `PENDING` File record. Validates MIME type and size per context.

### POST /api/upload/confirm
Auth: context-aware
```
Body: { fileId, context, ...linking fields }
```
Idempotent. Verifies object exists in R2 via HeadObject. Marks COMPLETED. Links artifact.

---

## Internal Routes

### POST /api/internal/r2-webhook
Header: `x-worker-secret: WORKER_SECRET`  
Marks File records COMPLETED from Worker queue events.

### POST /api/internal/orphan-sweep
Header: `x-worker-secret: WORKER_SECRET`  
Deletes PENDING File records older than 24h from R2 and marks FAILED.

---

## Common Response Patterns

```ts
// Success
return NextResponse.json({ ok: true })
return NextResponse.json({ ok: true, item: created })
return NextResponse.json({ items })

// Client error
return NextResponse.json({ error: "message" }, { status: 400 })
return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
return NextResponse.json({ error: "Not found" }, { status: 404 })
return NextResponse.json({ error: "Already submitted" }, { status: 409 })

// Warning (not an error — needs client confirmation)
return NextResponse.json({ warning: true, message: "...", affectedTasks: [...] }, { status: 200 })

// Blocked (student cannot proceed)
return NextResponse.json({ blocked: true, status: child.status, reason?: "..." }, { status: 409 })

// Server error
return NextResponse.json({ error: msg }, { status: 500 })
```
