# Project: Liberty Library Literacy Platform
## Claude Code System Instructions

---

### 1. Project Overview & Vision

A production-grade, admin-controlled literacy learning platform. Students improve English literacy through Reading, Listening, Writing, and Speaking. The platform uses a **human-in-the-loop architecture** — students do not progress automatically. Admins manually approve payments, assign credentials, review assessments, assign levels, create daily tasks, and review submissions.

**Why this design:**
- Works now without complex AI
- Human-reviewed submissions produce high-quality training data
- Future AI systems trained on real writing and speech artifacts

**Three-stage learning cycle:**
- **Placement** — Initial Assessment (multi-session, level-aware)
- **Practice** — Daily Tasks
- **Re-evaluation** — Periodic Assessment (admin-triggered)

**This is not a prototype.** Correctness, auditability, and admin authority matter more than automation convenience.

---

### 2. Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js App Router, React, TypeScript, Tailwind CSS |
| Backend | Next.js Route Handlers, Node.js runtime |
| Database | PostgreSQL + Prisma ORM (Supabase-hosted) |
| Validation | Zod v4 via `lib/parseBody.ts` + `lib/schemas.ts` |
| Auth | JWT cookies — `student_token` / `admin_token` — `lib/auth.ts` canonical |
| File Storage | Cloudflare R2 private bucket — `lib/r2.ts` canonical |
| Worker | Cloudflare Worker — queue consumer + cron orphan sweep |
| Audio | Browser `MediaRecorder` API → `audio/webm` → presigned PUT to R2 |
| Route Protection | `proxy.ts` (NOT `middleware.ts`) — JWT decode via `atob()` |

---

### 3. Student Status State Machine — CRITICAL

```
pending_payment → approved_pending_login → assessment_required → pending_level_review → active
```

**This flow MUST remain intact. No shortcuts. No silent jumps. No automation.**

- Periodic re-evaluation does **NOT** change `Child.status`. Student stays `active`.
- `archivedAt` is orthogonal to status — soft delete only, does not affect state machine.

---

### 4. Schema — Critical Current State

Read `prisma/schema.prisma` before any schema-related work. Key facts:

- **`isAssessmentDefault` DOES NOT EXIST** on `ContentItem`. Removed in Session IV migration. Any code referencing it will crash with a 500.
- **`AssessmentDefaultContent`** is the junction table assigning content to `(level, skill, sessionNumber)` slots.
- **`Assessment.taskFormat`** is derived from the listening slot question bank at row creation time — **not stored in `AssessmentConfig`**.
- **`AssessmentConfig`** only has: `id`, `initialSessionCount`, `updatedByAdminId`, `updatedAt`, `createdAt`.
- **`AuditAction`** enum includes `PERIODIC_TRIGGERED`. Use it for trigger audit events — not `LEVEL_CHANGED`.
- **`@@unique([childId, kind])`** on `Assessment` was removed. Multiple sessions per child+kind are supported.

Migration history: `add_taskformat_assessment_sessions_wordcount` → `add_content_item_question_bank_link` → `add_missing_indexes` → `add_assessment_default_content_config`

---

### 5. Upload Architecture — Never Revert

**All uploads use the three-step presign → R2 PUT → confirm flow.**

```
POST /api/upload/presign   → creates PENDING File row, returns presignedUrl + fileId
Client PUTs blob to R2     → Content-Type header ONLY. NO Content-Length. NO checksum headers.
POST /api/upload/confirm   → marks COMPLETED, links artifact
```

Worker path runs in parallel (R2 event → Queue → Worker → r2-webhook). Both paths are idempotent.

**Never include `ContentLength` in `PutObjectCommand`. It causes R2/browser checksum failures.**

---

### 6. File Serving — Never Expose Raw R2 URLs

Bucket is **PRIVATE**. All file access goes through API routes:
- `/api/admin/files/[id]` — admin downloads, 300s presigned GET
- `/api/admin/receipts/[fileId]` — receipt viewing, 60s presigned GET
- `/api/student/content/[fileId]` — student content access, 300s presigned GET

`ContentItem.assetUrl` is stored as `/api/student/content/{fileId}` — never a raw R2 URL.

---

### 7. Authentication Rules

**NEVER call `jwt.verify()` directly in a route file.** Always use:
- `verifyAdminJwt(token)` — admin routes
- `verifyStudentJwt(token)` — student routes

Both enforce role claim, HS256 algorithm, and payload shape. They throw on failure — catch and return 401.

`proxy.ts` decodes JWT with `atob()` only — no Node.js crypto in middleware.

---

### 8. Validation Rules

**NEVER cast `req.json()` directly as a type.** Always use:

```ts
const parsed = parseBody(MySchema, await req.json().catch(() => null), "context")
if (!parsed.ok) return parsed.response
const body = parsed.data
```

Import shared schemas — never redeclare:
```ts
import { LiteracyLevelSchema, SkillSchema, IdSchema } from "@/lib/schemas"
```

**Zod v4 syntax rules:**
- Custom error: `error: "message"` (not `errorMap`)
- superRefine issues: `code: "custom"` (not `z.ZodIssueCode.custom`)
- Record defaults: use `= {}` at destructure site — do NOT use `.default({})` on `z.record(z.enum(...))`

---

### 9. Assessment Engine — Key Behaviour

**Initial multi-session flow:**
1. Admin configures `initialSessionCount` (1–5) and assigns content to `AssessmentDefaultContent` slots
2. Listening slots require a question bank before they can be assigned
3. Student submits session N → if `sessionNumber < initialSessionCount`: create session N+1, keep status `assessment_required`
4. If last session: set `Child.status = pending_level_review`
5. Admin reviews all sessions via `allSessions` array, assigns level once

**taskFormat derivation:**
1. Find `AssessmentDefaultContent` slot for `(level, "listening", sessionNumber)`
2. Read `contentItem.questionBank.textBody` → parse → `questions[0].type`
3. If no bank: default to `free_response`

**Assessment vs daily task listening:**
- Assessment: **one-shot submit** — no retry, no "Check answers" step
- Daily task: **three-retry** — check → reveal → retry (up to 3 attempts)

---

### 10. Developer Workflow Rules

**Plan first:** For any non-trivial change:
1. Explain the architecture logic
2. Identify the true root cause
3. Propose the implementation approach
4. Then write code

**Testing commands:**
```bash
npm run dev
npx prisma generate
npx prisma migrate dev --name migration_name
Remove-Item -Recurse -Force .next   # Windows — clear Turbopack cache
```

**Status updates:** End every response with:
- ✔ Completed
- 🔄 In Progress
- ⏭ Next

---

### 11. Strict Technical Rules — Never Violate

- Never automate level promotion
- Never break the status state machine
- Never make submissions mutable after `isCompleted = true` or `submittedAt` is set
- Never expose raw R2 URLs to students
- Never include `ContentLength` in R2 `PutObjectCommand`
- Never serialize Prisma `BigInt` directly to JSON — convert to `.toString()`
- Never call `jwt.verify()` directly in routes
- Never cast `req.json()` as a type
- Never redeclare domain schemas
- Never reference `isAssessmentDefault` — field was removed
- Never use `void load()` style `useEffect` — use inline `async run()` with cancelled flag
- Never set `Child.status` from periodic re-evaluation code
- Never increase `initialSessionCount` without all required slots filled

---

### 12. Reference Files

Detailed documentation is in `.claude/`:

| File | Contents |
|------|---------|
| `.claude/database.md` | Full schema reference, all models, migration history |
| `.claude/auth.md` | JWT, cookies, token signing, proxy.ts, fetchWithAuth |
| `.claude/api.md` | All route signatures, validation patterns, response shapes |
| `.claude/r2-storage.md` | R2 config, upload flow, key structure, file serving |
| `.claude/assessment-engine.md` | Full assessment lifecycle, slot system, QB derivation |
| `.claude/coding-style.md` | React patterns, Zod patterns, Prisma patterns, useEffect rules |
| `.claude/state-machine.md` | Full status machine, all transitions, rules |
| `.claude/known-issues.md` | Open bugs from Session IV testing with potential solutions |
| `.claude/dev_checklist.md` | Completed work, pending tasks, priorities, production TODOs |
| `.claude/billing-subscription.md` | Full billing & subscription design — schema, routes, UI, access control, premium tier notes |
| `.claude/payment-plans.md` | Future payment plans, subscription tiers (Standard/Premium), gateway integration (Stripe/PayMongo), multi-plan architecture, implementation sequence |

## 13. Tooling Efficiency Rules

Use the CLI for cheap, mechanical, deterministic work.  
Use Claude for reasoning, synthesis, debugging, design decisions, and writing.

### Prefer CLI for fetching and discovery

When information can be gathered directly and cheaply, prefer terminal commands instead of spending model context on broad discovery.

Examples:
- changed files → `git diff --name-only`
- searching for symbols/text → `grep`, `rg`, or equivalent
- directory listing → `ls`, `dir`, `tree`
- build/test results → run the actual command
- migration status → run Prisma commands directly
- git status/history → use git commands directly

Claude should not be used to perform wide project scans when the CLI can first narrow the search space.

### Prefer Claude for thinking and writing

Use Claude when the task requires interpretation, reasoning, or multi-file understanding.

Examples:
- tracing a bug across frontend, API, and database layers
- understanding existing architecture before adding a feature
- comparing two implementations and judging tradeoffs
- refactoring code safely
- updating technical docs, handover notes, and checklists
- identifying likely causes of failures from logs or diffs

### 14. Correct workflow pattern

Preferred pattern:
1. Use CLI to gather raw facts.
2. Pass the relevant outputs or file targets to Claude.
3. Let Claude analyze, decide, and write.

Example:
- First run `git diff --name-only` or `rg "assessment"` to narrow scope.
- Then ask Claude to inspect only the relevant files and reason about the issue.

### Avoid these bad patterns

Avoid asking Claude to:
- scan the whole codebase without scope when simple CLI search can narrow it first
- discover changed files when git can provide them directly
- simulate build/test output that can be obtained by running the real command
- do repetitive file-system inspection better handled by terminal tools

Avoid over-restricting Claude when deep reasoning is needed.  
If a bug or feature genuinely spans multiple files, Claude should still read those files.

### 15. Practical rule

Use CLI for **fetching**.  
Use Claude for **thinking**.

Do not optimize tokens so aggressively that context quality collapses.  
A smaller but well-chosen context is better than a broad blind scan, but too little context can produce worse decisions and more back-and-forth.

### Project expectation

For this project:
- use CLI first to identify changed files, search symbols, and collect logs/errors
- use Claude to analyze architecture, trace logic, propose fixes, and update documentation
- when a task involves meaningful reasoning across existing code, it is acceptable for Claude to read multiple relevant files
- prefer targeted context over whole-project scanning unless whole-project analysis is truly necessary