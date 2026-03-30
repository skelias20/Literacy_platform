# Liberty Library — Literacy Learning Platform

A production-grade, admin-controlled literacy learning platform. Students improve English literacy through **Reading, Listening, Writing, and Speaking**. The platform operates on a human-in-the-loop architecture — no automated progression. Admins control every stage.

---

## What it does

Students register, pay, and are assigned credentials by an admin. They take a structured initial assessment across all four skills, get placed at a literacy level, then receive daily tasks. Admins review everything: payments, assessment artifacts, daily submissions. The system is designed to produce high-quality human-reviewed training data for future AI integration.

---

## Tech Stack

| | |
|---|---|
| **Frontend** | Next.js App Router, React, TypeScript, Tailwind CSS |
| **Backend** | Next.js Route Handlers, Node.js runtime |
| **Database** | PostgreSQL + Prisma ORM (Supabase-hosted) |
| **Validation** | Zod v4 via `lib/parseBody.ts` |
| **Auth** | JWT cookies — `student_token` / `admin_token` |
| **File Storage** | Cloudflare R2 (private bucket, presigned URLs) |
| **Worker** | Cloudflare Worker — queue consumer + orphan sweep cron |
| **Audio** | Browser `MediaRecorder` API → `audio/webm` → R2 |

---

## Student Flow

```
Register + upload payment receipt
        ↓
Admin approves payment + creates credentials
        ↓
Student logs in → completes initial assessment (all 4 skills)
        ↓
Admin reviews artifacts → assigns literacy level
        ↓
Student receives daily tasks → earns Reading Points
        ↓
Admin triggers periodic re-evaluation → student repeats assessment
```

---

## Project Structure

```
app/
├── admin/              # Admin pages (content, tasks, assessments, students, payments)
├── student/            # Student pages (dashboard, assessment, tasks)
├── register/           # Public registration
└── api/
    ├── admin/          # Admin API routes
    ├── student/        # Student API routes
    ├── upload/         # presign + confirm (R2 upload flow)
    └── internal/       # Worker webhook + orphan sweep

lib/
├── r2.ts               # R2 operations — source of truth
├── auth.ts             # JWT sign/verify — source of truth
├── prisma.ts           # Prisma client singleton
├── parseBody.ts        # Zod validation helper
├── schemas.ts          # Shared domain schemas
├── fetchWithAuth.ts    # Client-side authenticated fetch
├── rateLimit.ts        # In-memory sliding window limiter
└── wordCount.ts        # Word count utilities

prisma/
├── schema.prisma
└── migrations/

worker/
└── src/index.ts        # Cloudflare Worker

.claude/                # Claude Code reference files
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (Supabase or local)
- Cloudflare R2 bucket (private)
- Cloudflare Worker (for production upload events)

### Environment Variables

```env
DATABASE_URL=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# JWT
JWT_SECRET=

# Internal worker secret
WORKER_SECRET=
```

### Setup

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

Admin panel: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## Key Architecture Rules

- **All file uploads** use the three-step `presign → R2 PUT → confirm` flow. Never server-buffered.
- **R2 bucket is private.** File access always goes through API routes that generate presigned GET URLs. Never expose raw R2 URLs to students.
- **No `ContentLength` in R2 PUT.** Causes checksum failures with the browser `fetch()` API.
- **Auth is canonicalised.** Never call `jwt.verify()` directly — use `lib/auth.ts` helpers.
- **Validation is canonicalised.** Never cast `req.json()` — use `parseBody` + Zod.
- **`BigInt` from Prisma** (`File.byteSize`) must be `.toString()` before any JSON response.
- **State machine is immutable.** `pending_payment → approved_pending_login → assessment_required → pending_level_review → active`. No shortcuts.
- **Submissions are immutable** after `isCompleted = true` or `submittedAt` is set.
- **Rate limiter is disabled in development** intentionally. Active in production.

---

## Assessment System

The initial assessment supports multiple sessions (configured per admin). Each session uses level-specific content assigned through the `AssessmentDefaultContent` slot system. Listening content requires a question bank (MCQ / multiple short answer / fill-in-the-blank) before it can be assigned to a slot. The session format is derived automatically from the question bank.

Periodic re-evaluations are admin-triggered and do not affect student status.

---

## Developer Reference

For Claude Code continuation, see:

- `.claude/CLAUDE.md` — system instructions and rules
- `.claude/database.md` — schema reference
- `.claude/auth.md` — auth patterns
- `.claude/r2-storage.md` — upload and file serving
- `.claude/assessment-engine.md` — full assessment lifecycle
- `.claude/coding-style.md` — React, Zod, Prisma patterns
- `.claude/state-machine.md` — all status transitions
- `.claude/api.md` — all route signatures
- `.claude/known-issues.md` — open issues with potential solutions

---

## Literacy Levels

Students are placed at one of four levels after assessment review:

`foundational` → `functional` → `transitional` → `advanced`

Level advancement is always admin-initiated — never automatic.