# Authentication Reference

## Overview

Two separate JWT cookies: `student_token` and `admin_token`. Both use HS256. Both inject a `role` claim. `lib/auth.ts` is the single source of truth — never call `jwt.verify()` directly in route files.

---

## lib/auth.ts — Canonical Functions

```ts
signAdminJwt(adminId: string): string
signStudentJwt(childId: string): string
verifyAdminJwt(token: string): { adminId: string; role: "admin" }    // throws on failure
verifyStudentJwt(token: string): { childId: string; role: "student" } // throws on failure
```

`sign*` functions inject `role` automatically — do not pass role explicitly.
`verify*` functions enforce: role claim presence, HS256 algorithm, correct payload shape.

---

## Usage Pattern in Routes

```ts
import { verifyAdminJwt, verifyStudentJwt } from "@/lib/auth"
import { cookies } from "next/headers"

// Admin route
async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("admin_token")?.value
  if (!token) return null
  try { return verifyAdminJwt(token).adminId }
  catch { return null }
}

// Student route
async function requireStudent(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("student_token")?.value
  if (!token) return null
  try { return verifyStudentJwt(token).childId }
  catch { return null }
}
```

---

## proxy.ts (Route Protection)

File: `proxy.ts` at project root. NOT `middleware.ts`.

- Decodes JWT payload using `atob()` only — no Node.js crypto (runs in edge-like environment)
- Checks `exp` claim — redirects to login with `?expired=1` and clears cookie if expired
- Protects all `/admin/*` and `/student/*` routes
- Does not protect `/api/*` routes — those verify tokens themselves

---

## fetchWithAuth (Client-side)

File: `lib/fetchWithAuth.ts`

```ts
import { studentFetch } from "@/lib/fetchWithAuth"
import { adminFetch }   from "@/lib/fetchWithAuth"
```

Both are drop-in replacements for `fetch()` on authenticated pages. They:
- Add credentials to requests
- Intercept 401 responses and redirect to the appropriate login page
- Preserve all other response behaviour

**All authenticated client components and pages must use these — never raw `fetch()` for app API calls.**
Raw `fetch()` is ONLY acceptable for the direct R2 PUT step (Cloudflare URL, not app API).

---

## Presign Route — Dual Cookie Context

`POST /api/upload/presign` handles both student and admin uploads. The route selects the token based on `context`:

- `assessment_audio`, `daily_audio` → prefer `student_token`
- `admin_content` → prefer `admin_token`
- `receipt` → either (registration context has neither yet; uses anonymous path)

This prevents 403 errors when both cookies are present in dev (e.g., admin logged in on same browser).

---

## Rate Limiting

File: `lib/rateLimit.ts` — in-memory sliding window.

```ts
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rateLimit"

const rl = rateLimit(`admin_content:${ip}`, RATE_LIMITS.adminUpload)
if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
```

**Rate limiter is intentionally disabled in development** (`NODE_ENV=development` bypass). Do not remove this bypass. In dev, all localhost requests share an `'unknown'` IP which would exhaust limits immediately.

In production: limiter is active. A Redis-backed limiter is planned for multi-instance scale but not yet built.

---

## Common Auth Errors

| Error | Cause | Fix |
|-------|-------|-----|
| 403 on `/api/upload/presign` | Rate limit exhausted | Restart dev server |
| 403 on `/api/upload/presign` | Wrong cookie for context | Check context field — student contexts need student_token |
| 401 everywhere after deployment | Old tokens without role claim | Users must re-login once |
| 401 on mid-session action | Token expired | fetchWithAuth intercepts and redirects — check proxy.ts exp check |
| "Account deactivated" on login | `archivedAt` is set | Admin must unarchive from /admin/students |
