# Database Reference

## Stack
PostgreSQL hosted on Supabase. Prisma ORM. Schema file: `prisma/schema.prisma`.

---

## Migration History (chronological)

| Migration | Key Changes |
|-----------|------------|
| base | Parent, Child, Payment, File, ContentItem, Assessment, DailyTask, DailySubmission, DailySubmissionArtifact, AssessmentArtifact, RpEvent, AdminAuditLog |
| add_taskformat_assessment_sessions_wordcount | TaskFormat enum; DailyTask.taskFormat/writingMinWords/writingMaxWords; answersJson on artifacts; Assessment.sessionNumber/isLatest/taskFormat/triggeredByAdminId; AssessmentConfig; removed @@unique([childId,kind]) on Assessment |
| add_content_item_question_bank_link | ContentItem.parentContentItemId self-reference (one audio → one question bank ContentItem) |
| add_missing_indexes | Child(level), Child(archivedAt), DailyTask(taskDate,level), DailySubmission(dailyTaskId) |
| add_assessment_default_content_config | AssessmentDefaultContent junction table; REMOVED isAssessmentDefault from ContentItem; REMOVED taskFormat + periodicSessionCount from AssessmentConfig; ADDED PERIODIC_TRIGGERED to AuditAction enum |

---

## Key Enums

```prisma
enum AccountStatus { pending_payment, approved_pending_login, assessment_required, pending_level_review, active, rejected }
enum LiteracyLevel { foundational, functional, transitional, advanced }
enum SkillType     { reading, listening, writing, speaking }
enum AssessmentKind { initial, periodic }
enum TaskFormat    { free_response, mcq, msaq, fill_blank }
enum UploadStatus  { PENDING, COMPLETED, FAILED }
enum ContentType   { passage_text, passage_audio, questions, writing_prompt, speaking_prompt, pdf_document }
enum AuditAction   { PAYMENT_APPROVED, PAYMENT_REJECTED, CREDENTIALS_CREATED, LEVEL_ASSIGNED, LEVEL_CHANGED, DAILY_SKILL_FOCUS_SET, CONTENT_CREATED, CONTENT_ASSIGNED, STUDENT_PROFILE_EDITED, PERIODIC_TRIGGERED }
enum PaymentMethod { receipt_upload, transaction_id }
enum PaymentStatus { pending, approved, rejected }
```

---

## Key Models

### Child
```
id, parentId, childFirstName, childLastName, grade, dateOfBirth, subjects String[]
username?, passwordHash?
credentialsCreatedById?, credentialsCreatedAt?
status AccountStatus @default(pending_payment)
level LiteracyLevel?, levelAssignedById?, levelAssignedAt?
lastDailySubmissionAt?, archivedAt?
```

### ContentItem
```
id, title, description?, skill SkillType, level LiteracyLevel?, type ContentType
textBody?, fileId?, assetUrl?, mimeType?
parentContentItemId? @unique   ← question bank points to its audio parent
questionBank ContentItem?       ← audio has one question bank
createdByAdminId, createdAt, deletedAt?
assessmentDefaultSlots AssessmentDefaultContent[]
```
**CRITICAL:** `isAssessmentDefault` NO LONGER EXISTS on this model.

### AssessmentDefaultContent (new in Session IV)
```
id, level LiteracyLevel, skill SkillType, sessionNumber Int
contentItemId, createdByAdminId, createdAt
@@unique([level, skill, sessionNumber])
@@index([level, skill])
```
One row per slot. Replacing content in a slot upserts on the unique key.

### Assessment
```
id, childId, kind AssessmentKind @default(initial)
sessionNumber Int @default(1)
isLatest Boolean @default(true)
taskFormat TaskFormat @default(free_response)  ← derived from QB at creation, not config
triggeredByAdminId?, startedAt?, submittedAt?
reviewedByAdminId?, reviewedAt?, assignedLevel?
artifacts AssessmentArtifact[]
@@index([childId, kind, isLatest])
```

### AssessmentConfig (single row — always upsert)
```
id, initialSessionCount Int @default(1)
updatedByAdminId, updatedAt, createdAt
```
**CRITICAL:** `taskFormat` and `periodicSessionCount` NO LONGER EXIST here.

### AssessmentArtifact
```
id, assessmentId, skill SkillType
textBody?, fileId?, answersJson Json?  ← structured Q&A for MCQ/MSAQ/fill_blank
createdAt
```

### DailyTask
```
id, taskDate DateTime, skill SkillType, level LiteracyLevel?
rpValue Int @default(10)
taskFormat TaskFormat @default(free_response)
writingMinWords Int?, writingMaxWords Int?
createdByAdminId, createdAt
contentLinks DailyTaskContent[]
```

### DailySubmission
```
id, childId, dailyTaskId
submittedAt?, isCompleted Boolean @default(false), rpEarned Int @default(0)
artifacts DailySubmissionArtifact[]
@@unique([childId, dailyTaskId])
```

### DailySubmissionArtifact
```
id, dailySubmissionId, skill SkillType
textBody?, fileId?, answersJson Json?
```

### File
```
id, storageKey, r2Key?, storageUrl?, originalName, mimeType
byteSize BigInt   ← MUST be .toString() before JSON response
sha256?, uploadStatus UploadStatus @default(PENDING), failureReason?, deletedAt?
uploadedByAdminId?, uploadedByChildId?
```

### AdminAuditLog
```
id, adminId, action AuditAction
targetChildId?, targetPaymentId?, targetContentId?, targetDailyTaskId?, targetAssessmentId?
metadata Json @default("{}")
createdAt
```

---

## Prisma Usage Rules

- Never serialize `BigInt` directly. Always: `byteSize: file.byteSize.toString()`
- Use `prisma.$transaction(async (tx) => { ... })` for multi-step atomic operations
- Use `updateMany` + `create` pattern when rotating `isLatest` flags
- Prisma client singleton is at `lib/prisma.ts` — never instantiate directly in routes

---

## Querying Assessment Slots

```ts
// Get content for a student's current session
const slots = await prisma.assessmentDefaultContent.findMany({
  where: { sessionNumber: assessment.sessionNumber, level: child.level ?? "foundational" },
  select: { skill: true, contentItem: { select: { ... , questionBank: { select: { textBody, deletedAt } } } } }
})

// Upsert a slot
await prisma.assessmentDefaultContent.upsert({
  where: { level_skill_sessionNumber: { level, skill, sessionNumber } },
  update: { contentItemId, createdByAdminId },
  create: { level, skill, sessionNumber, contentItemId, createdByAdminId }
})
```
