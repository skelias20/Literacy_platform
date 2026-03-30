# Coding Style Reference

## General Philosophy

- Server-driven correctness over fragile frontend state assumptions
- Fix root causes — no UI bandaids, no duplicate requests, no redundant state
- Idiomatic Next.js and Prisma patterns
- Minimal code changes that solve the root cause
- Prefer explicit server rules over speculative frontend guards

---

## API Route Pattern

```ts
// Standard route structure
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { cookies } from "next/headers"
import { verifyAdminJwt } from "@/lib/auth"  // or verifyStudentJwt
import { parseBody } from "@/lib/parseBody"
import { LiteracyLevelSchema, SkillSchema, IdSchema } from "@/lib/schemas"

export const runtime = "nodejs"

const MySchema = z.object({
  id: IdSchema,
  level: LiteracyLevelSchema,
})

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("admin_token")?.value
  if (!token) return null
  try { return verifyAdminJwt(token).adminId }
  catch { return null }
}

export async function POST(req: Request) {
  try {
    const adminId = await requireAdmin()
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const parsed = parseBody(MySchema, await req.json().catch(() => null), "context/name")
    if (!parsed.ok) return parsed.response
    const { id, level } = parsed.data

    // ... business logic

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

---

## Zod v4 Rules

```ts
// ✅ Custom error (v4)
z.string().min(1, { error: "Required" })

// ❌ Not v4 syntax
z.string().min(1, { message: "Required" })   // WRONG in v4 — use 'error' not 'message' for custom

// ✅ superRefine custom issue (v4)
.superRefine((val, ctx) => {
  ctx.addIssue({ code: "custom", message: "error" })
})

// ❌ Not v4 syntax
ctx.addIssue({ code: z.ZodIssueCode.custom, message: "error" })  // WRONG

// ✅ Record default (v4)
const { myRecord = {} } = parsed.data

// ❌ Not v4
z.record(z.enum([...]), z.array(z.string())).default({})  // BREAKS in v4
```

---

## React / Next.js Patterns

### useEffect data loading

```ts
// ✅ CORRECT pattern — always
useEffect(() => {
  let cancelled = false
  const run = async () => {
    setLoading(true)
    const res = await adminFetch("/api/admin/something")
    const data = await res.json().catch(() => ({}))
    if (cancelled) return  // ← critical: prevent stale state updates
    setData(data.items ?? [])
    setLoading(false)
  }
  void run()
  return () => { cancelled = true }
}, [dependency])

// ❌ WRONG patterns — causes warnings and stale updates
useEffect(() => {
  void load()  // BAD — no cancellation
}, [])

useEffect(() => {
  setData(someValue)  // BAD — synchronous setState in effect body
}, [])
```

### Fetch in client components

```ts
// ✅ All app API calls from client
import { adminFetch } from "@/lib/fetchWithAuth"
import { studentFetch } from "@/lib/fetchWithAuth"

const res = await adminFetch("/api/admin/content", { method: "POST", ... })

// ❌ Never raw fetch for app API calls
const res = await fetch("/api/admin/content", ...)  // BAD — no 401 interception

// ✅ Raw fetch ONLY for direct R2 PUT
const r2Res = await fetch(presignedUrl, { method: "PUT", ... })  // OK — Cloudflare URL
```

### Server components (app/student/page.tsx, etc.)

```ts
// ✅ Server component pattern — direct Prisma access
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { verifyStudentJwt } from "@/lib/auth"

export default async function Page() {
  const cookieStore = await cookies()
  const token = cookieStore.get("student_token")?.value
  const payload = verifyStudentJwt(token!)
  const child = await prisma.child.findUnique({ where: { id: payload.childId } })
  // ...
}
```

---

## BigInt Serialization

```ts
// ✅ Always serialize BigInt before JSON response
const items = rawItems.map(item => ({
  ...item,
  file: item.file ? { ...item.file, byteSize: item.file.byteSize.toString() } : null
}))
return NextResponse.json({ items })

// ❌ Never
return NextResponse.json({ file })  // BAD if file.byteSize is BigInt — throws 500
```

---

## Prisma Patterns

```ts
// Transaction pattern for atomic operations
await prisma.$transaction(async (tx) => {
  // Mark previous as not latest
  await tx.assessment.updateMany({
    where: { childId, kind: "initial", isLatest: true },
    data: { isLatest: false }
  })
  // Create new latest
  await tx.assessment.create({ data: { childId, isLatest: true, ... } })
})

// Upsert on unique constraint
await prisma.assessmentDefaultContent.upsert({
  where: { level_skill_sessionNumber: { level, skill, sessionNumber } },
  update: { contentItemId, createdByAdminId },
  create: { level, skill, sessionNumber, contentItemId, createdByAdminId }
})
```

---

## TypeScript Rules

```ts
// ✅ Type API responses explicitly
const data = await res.json().catch(() => ({}))
setItems((data as { items?: MyType[] }).items ?? [])

// ✅ Use 'as never' for Prisma enum fields when TypeScript complains
await prisma.contentItem.create({
  data: { skill: body.skill as never, type: body.type as never }
})

// ✅ Unknown error handling
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : "Server error"
  return NextResponse.json({ error: msg }, { status: 500 })
}
```

---

## File Upload in Client Components

```ts
// Three-step flow — always
async function handleUpload(file: File, context: string): Promise<string | null> {
  // Step 1: Presign
  const presignRes = await adminFetch("/api/upload/presign", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context, mimeType: file.type, byteSize: file.size, originalName: file.name })
  })
  if (!presignRes.ok) { /* handle error */ return null }
  const { presignedUrl, fileId } = await presignRes.json()

  // Step 2: Direct R2 PUT — raw fetch, Content-Type ONLY
  const r2Res = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },  // NO Content-Length
    body: file
  })
  if (!r2Res.ok) { /* handle error */ return null }

  // Step 3: Confirm
  const confirmRes = await adminFetch("/api/upload/confirm", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, context })
  })
  if (!confirmRes.ok) { /* handle error */ return null }

  return fileId
}
```

---

## Stale Cache

When code changes are not reflected despite saving:
```bash
Remove-Item -Recurse -Force .next   # Windows
rm -rf .next                         # Unix
```
Then restart `npm run dev`.
