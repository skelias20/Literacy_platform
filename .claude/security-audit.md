# Security Audit — Auth & Session Layer
## Liberty Library Literacy Platform

**Audit Date:** 2026-04-03  
**Scope:** JWT signing/verification, cookie configuration, session lifecycle, rate limiting, CSRF, authorization patterns  
**Status:** Audit complete — remediation in progress

---

## How to use this file

Work through items in priority order. For each item:
1. Read the description and affected files
2. Apply the fix
3. Test the affected flow end-to-end
4. Mark the item `✔ Fixed` and record the date

---

## Priority 1 — Critical

### SEC-01: Five routes bypass `lib/auth.ts` — no algorithm restriction

**Status:** ✔ Fixed — 2026-04-03

**Description:**  
Five route files import `jsonwebtoken` directly and call `jwt.verify(token, SECRET)` without passing `{ algorithms: ["HS256"] }`. Without the algorithm restriction, `jsonwebtoken` accepts whatever algorithm the token header declares. An attacker can craft a token with `"alg": "none"` (no signature at all) or exploit RS256/HS256 algorithm confusion. The `CLAUDE.md` rule "Never call `jwt.verify()` directly in routes" exists precisely because of this class of vulnerability — but these five files predate or missed the canonicalization pass.

**Affected files:**

| File | Issue |
|------|-------|
| `app/api/upload/confirm/route.ts` | lines 70, 83 — direct `jwt.verify()` without algorithm restriction |
| `app/api/admin/inactive-students/route.ts` | line 30 — direct `jwt.verify()` without algorithm restriction |
| `app/api/student/daily-tasks/route.ts` | line 30 — direct `jwt.verify()` without algorithm restriction |
| `app/api/student/daily-tasks/[taskId]/artifact/route.ts` | line 23 — direct `jwt.verify()` without algorithm restriction |
| `app/api/admin/receipts/[fileId]/route.ts` | line 36 — direct `jwt.verify()` without algorithm restriction |

**Attack vector:**  
Attacker crafts a JWT with `"alg": "none"` and arbitrary `childId`/`adminId` claims. The library accepts it as valid without checking the signature. Attacker gains unauthorized access to any student or admin route that uses these bypassing implementations.

**Fix:**  
Replace all direct `jwt.verify()` calls and local `jwt.sign()` / `mustGetEnv("JWT_SECRET")` patterns with the canonical helpers from `lib/auth.ts`:

```ts
// REMOVE this pattern in affected routes:
import jwt from "jsonwebtoken"
const SECRET = mustGetEnv("JWT_SECRET")
const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload

// REPLACE with:
import { verifyAdminJwt, verifyStudentJwt } from "@/lib/auth"
const payload = verifyAdminJwt(token)   // throws on failure
const payload = verifyStudentJwt(token) // throws on failure
```

The canonical helpers enforce `{ algorithms: ["HS256"] }`, role claim presence, and payload shape. Wrap in try/catch and return 401 on throw.

---

### SEC-02: No role claim verification in bypassing routes

**Status:** ✔ Fixed — 2026-04-03 (resolved by SEC-01 fix)  
**Depends on:** SEC-01 (same fix resolves both)

**Description:**  
Beyond the algorithm issue, the bypassing routes only check field presence (e.g. `typeof p.childId === "string"`) — they do **not** verify `role === "student"` or `role === "admin"`. An admin token passed to a student route, or vice versa, would be accepted if the field shapes happen to satisfy the minimal check.

**Affected files:** Same five files as SEC-01.

**Attack vector:**  
An admin user accesses a student-only route using their own valid admin token. The route checks `p.childId` — if an admin token happens to carry a matching field (or if a future schema change adds one), the role boundary breaks.

**Fix:**  
Resolved by the same fix as SEC-01. The canonical `verifyStudentJwt` / `verifyAdminJwt` helpers enforce `obj.role !== "student"` / `obj.role !== "admin"` and throw if the claim is wrong.

---

## Priority 2 — High

### SEC-03: JWT expiry (1 day) vs cookie `maxAge` (7 days) mismatch

**Status:** ✔ Fixed (Option A) — 2026-04-03

**Description:**  
Login routes set cookies with `maxAge: 60 * 60 * 24 * 7` (7 days) but the JWT inside expires after `"1d"` (24 hours). After 24 hours, the browser continues to send the cookie containing an already-expired JWT. The middleware's `isTokenExpired()` check will eventually clear it on a page navigation, but:

- All API calls during that window return 401
- `fetchWithAuth` redirects on 401 — creating redirect loops
- The stale cookie remains for 6 more days unless the user actively navigates

**Affected files:**  
- `app/api/admin/login/route.ts` line 53: `maxAge: 60 * 60 * 24 * 7`  
- `app/api/student/login/route.ts` line 71: `maxAge: 60 * 60 * 24 * 7`

**Fix (option A — align, simplest):**  
Set `maxAge` to match JWT expiry:
```ts
maxAge: 60 * 60 * 24, // 1 day — matches JWT expiresIn: "1d"
```

**Fix (option B — refresh tokens, correct long-term):**  
Issue short-lived access tokens (15 min JWT) and a separate long-lived refresh token cookie. The refresh token is stored server-side (DB or Redis) and can be revoked. Access token is refreshed silently. This also solves SEC-04.

**Recommended:** Fix A now (align to 1 day). Plan Fix B as a follow-on when Redis is introduced.

---

### SEC-04: No token revocation — sessions cannot be immediately invalidated

**Status:** ✔ Fixed (token version counter) — 2026-04-03

**Description:**  
There is no mechanism to invalidate a token before its natural expiry. This means:

- A student whose account is archived still has a valid session for up to 24 hours
- A student whose password is reset by an admin retains their old session
- A compromised admin account cannot be locked out without waiting for token expiry
- There is no admin logout route at all (see SEC-08)

**Affected scenarios:**  
- `POST /api/admin/students/[childId]/reset-password` — does not invalidate existing student token
- `POST /api/admin/students/[childId]/archive` — does not invalidate existing student token  
- Admin session compromise — no kill mechanism

**Fix applied — token version counter (no Redis required):**  
Added `tokenVersion Int @default(0)` to both `Child` and `Admin` models (migration `add_token_version`). Every signed token embeds the current `tokenVersion` from the DB. On every API call, `requireAdminAuth()` / `requireStudentAuth()` in `lib/serverAuth.ts` verify the token and then do a single indexed primary-key lookup to confirm the token's version matches the DB. A mismatch returns null → 401.

Revocation is triggered by incrementing `tokenVersion` via `invalidateStudentSessions(childId)` or `invalidateAdminSessions(adminId)`:
- Student archived → `invalidateStudentSessions` in archive route
- Student password reset → `invalidateStudentSessions` in reset-password route
- Student logout → `invalidateStudentSessions` before cookie clear
- Admin logout → `invalidateAdminSessions` before cookie clear

All student and admin routes now use `requireAdminAuth()` / `requireStudentAuth()` from `lib/serverAuth.ts`. The presign and confirm routes use `verifyStudentToken()` / `verifyAdminToken()` (same version check, token passed directly for dual-context handling).

---

### SEC-05: No CSRF protection beyond `sameSite: lax`

**Status:** ✔ Fixed (Origin header validation) — 2026-04-03

**Description:**  
The platform has no CSRF token mechanism. `sameSite: "lax"` protects against cross-origin POST from `<form>` submissions, but does not protect against:
- Requests originating from same-site subdomains (if any exist)
- Certain browser redirect-chain edge cases
- Future migration to `sameSite: "none"` (required for cross-origin embedding)

For a platform handling payment approvals, level assignments, subscription management, and student archiving — all state-mutating admin actions — a missing CSRF layer is a meaningful risk.

**Affected routes:** All state-mutating POST/PUT/PATCH/DELETE admin routes.

**Fix applied — `Origin` header validation:**  
Created `lib/csrf.ts` with `validateOrigin(req)` and `isMutationMethod(req)`. The CSRF check is embedded in `requireAdminAuth(req)` and `requireStudentAuth(req)` in `lib/serverAuth.ts`:

- When `req` is passed and the method is POST/PUT/PATCH/DELETE, the `Origin` header is validated against the `Host` header. Mismatch → null → 401.
- GET handlers omit `req` from the call — no CSRF check, no behaviour change.
- Upload routes (`presign`, `confirm`) apply `validateOrigin(req)` inline at the top of their POST handler, returning 403 on mismatch.
- Login, register, logout, and internal webhook routes are intentionally excluded: login/register have no session to steal, and internal routes use server-to-server auth.

All 28 state-mutating route files updated. All GET routes unchanged.

**Fix (alternative — double-submit cookie):**  
Set a non-httpOnly CSRF token cookie at login. Require it as a header on mutations. Compare cookie value to header value server-side.

---

### SEC-06: Single shared JWT secret for both admin and student tokens

**Status:** ✔ Fixed — 2026-04-04

**Description:**  
One `JWT_SECRET` environment variable signs both `admin_token` and `student_token`. A single secret leak (log exposure, env dump, backup, or misconfigured secret manager) compromises all sessions across all roles simultaneously.

Additionally, a future code regression that removes role-claim checking would allow cross-role token reuse with a shared secret.

**Affected files:** `lib/auth.ts` — `requireEnv("JWT_SECRET")`

**Fix:**  
Introduce a second secret:
```env
JWT_ADMIN_SECRET=...   # high-entropy, separate rotation
JWT_STUDENT_SECRET=... # can be shared with student-facing infra only
```

Update `lib/auth.ts` to use `JWT_ADMIN_SECRET` in `signAdminJwt`/`verifyAdminJwt` and `JWT_STUDENT_SECRET` in `signStudentJwt`/`verifyStudentJwt`.

**Migration:** All existing tokens will be invalidated on deployment — users must re-login once. Acceptable at a planned deployment boundary.

---

## Priority 3 — Medium

### SEC-07: In-memory rate limiter is not multi-instance safe

**Status:** ⬜ Deferred — blocked on Upstash account (requires card). Full design notes and implementation steps are in `dev_checklist.md` § "DEFERRED — Security".  
**Already tracked in:** dev_checklist.md (Redis-backed limiter — deferred)

**Description:**  
`lib/rateLimit.ts` stores all sliding window state in a process-local `Map`. In any multi-instance deployment (Vercel serverless, multiple Node processes):
- Each instance has its own counter — an attacker rotates between instances, effectively multiplying their allowed attempts by the instance count
- Server restart clears all rate limit state
- Limits are never shared across processes

The login limits (`adminLogin: 5/15min`, `studentLogin: 10/15min`) are most critical to enforce correctly.

**Fix:**  
Replace the in-memory store with Redis calls. The sliding window logic itself is correct — only the storage backend needs to change:

```ts
// Use ioredis or @upstash/redis
const timestamps = await redis.lrange(key, 0, -1)
// ... same window eviction logic ...
await redis.rpush(key, now)
await redis.expire(key, windowMs / 1000)
```

Upstash Redis (serverless-friendly, HTTP-based) is recommended for Vercel deployments.

---

### SEC-08: No admin logout route

**Status:** ✔ Fixed — 2026-04-03

**Description:**  
There is a `POST /api/student/logout` route but **no equivalent for admins**. Admin tokens persist for their full 24-hour lifetime with no way to explicitly end the session. For a high-privilege role managing payments, student data, and assessments, this is an operational gap — particularly for shared-device or multi-admin scenarios.

**Affected files:** `app/api/student/logout/route.ts` exists; `app/api/admin/logout/route.ts` does not.

**Fix:**  
Create `app/api/admin/logout/route.ts`:
```ts
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set("admin_token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
  return res
}
```

Wire to the admin UI logout button. When SEC-04 (token revocation) is implemented, also add the `jti` to the deny list here.

---

## Priority 4 — Low

### SEC-09: `x-forwarded-for` header is not proxy-chain validated

**Status:** ✔ Fixed — 2026-04-03

**Description:**  
`getClientIp()` in `lib/rateLimit.ts` reads `x-forwarded-for` and takes the first value:
```ts
headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

`x-forwarded-for` is an append-only chain header set by each proxy layer. Without knowing which proxy you trust, a client behind no proxy can spoof this header entirely — sending `X-Forwarded-For: 1.2.3.4` to impersonate a different IP and avoid rate limiting.

**Severity context:** Low if behind Vercel or Cloudflare (they overwrite/strip client-set headers). High in a self-hosted or bare Node.js deployment.

**Fix:**  
If deploying behind Vercel: Vercel sets `x-vercel-forwarded-for` which cannot be spoofed by clients. Use that header instead of raw `x-forwarded-for`. If behind Cloudflare: use `cf-connecting-ip`.

```ts
export function getClientIp(req: Request): string {
  const headers = req.headers
  // Vercel-specific trusted header — not spoofable by clients
  return (
    headers.get("x-vercel-forwarded-for") ??
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}
```

---

### SEC-10: Diagnostic data exposed in error responses (presign route)

**Status:** ✔ Fixed — 2026-04-03

**Description:**  
`app/api/upload/presign/route.ts` builds a `diag` object containing `ip`, `nodeEnv`, `hasAdminToken`, `hasStudentToken`, `wantsStudent`, `wantsAdmin`, and token error messages. This object is returned in all error responses:

```ts
return NextResponse.json({ error, diag: { ...diag, ...(extra ?? {}) } }, { status })
```

In production, this gives an attacker insight into the auth flow — token presence, which contexts they tried, and specific error messages that help them refine an attack.

**Fix:**  
Strip `diag` from responses in production. Keep it for internal logging only:
```ts
const deny = (status: number, error: string, extra?: Record<string, unknown>) => {
  console.warn(`[upload/presign] deny ${status} ${error}`, { ...diag, ...(extra ?? {}) })
  // Never include diag in response body
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } })
}
```

---

### SEC-11: Student login reveals account status before password check

**Status:** ✔ Fixed — 2026-04-03

**Description:**  
`app/api/student/login/route.ts` performs the archived check and status check **after** a successful bcrypt comparison. This means:

1. Username is found
2. Password matches
3. **Then** archived/status check runs and returns `403`

The 403 with a specific message ("This account has been deactivated") is returned only after a correct password — which confirms to an attacker that the username+password combination is valid. This is a minor user enumeration vector for targeted accounts.

**Note:** This is a low-risk practical issue since the admin sets the password, not the student. But it is still correct security practice to reject archived accounts earlier.

**Fix:**  
Move the archived and status checks before the bcrypt comparison:
```ts
const child = await prisma.child.findUnique({ where: { username } })

if (!child || !child.passwordHash) {
  return NextResponse.json({ error: "Invalid credentials." }, { status: 401 })
}
// Check account state BEFORE bcrypt — avoids confirming valid credentials
if (child.archivedAt) {
  return NextResponse.json({ error: "Account deactivated." }, { status: 403 })
}
if (child.status === "pending_payment" || ...) {
  return NextResponse.json({ error: "Account not ready for login." }, { status: 403 })
}
// Now bcrypt
const ok = await bcrypt.compare(password, child.passwordHash)
```

---

## Remediation Progress

| ID | Description | Severity | Status | Fixed Date |
|----|-------------|----------|--------|------------|
| SEC-01 | 5 routes bypass lib/auth.ts — no algorithm restriction | Critical | ✔ Fixed | 2026-04-03 |
| SEC-02 | No role claim check in bypassing routes | Critical | ✔ Fixed | 2026-04-03 |
| SEC-03 | JWT expiry vs cookie maxAge mismatch (1d vs 7d) | High | ✔ Fixed (Option A) | 2026-04-03 |
| SEC-04 | No token revocation / session invalidation | High | ✔ Fixed | 2026-04-03 |
| SEC-05 | No CSRF protection beyond sameSite: lax | Medium | ✔ Fixed | 2026-04-03 |
| SEC-06 | Single shared JWT secret for both roles | Medium | ✔ Fixed | 2026-04-04 |
| SEC-07 | In-memory rate limiter not multi-instance safe | Medium | ⬜ Open | — |
| SEC-08 | No admin logout route | Low | ✔ Fixed | 2026-04-03 |
| SEC-09 | x-forwarded-for not proxy-chain validated | Low | ✔ Fixed | 2026-04-03 |
| SEC-10 | Diagnostic data exposed in presign error responses | Low | ✔ Fixed | 2026-04-03 |
| SEC-11 | Status check after bcrypt — minor credential confirmation | Low | ✔ Fixed | 2026-04-03 |

---

## Fix Sequence (Recommended)

### Phase 1 — No schema changes, no deployment risk (do now)
1. **SEC-01 + SEC-02** — Migrate 5 rogue routes to canonical `lib/auth.ts` helpers
2. **SEC-08** — Add admin logout route
3. **SEC-03** — Align cookie `maxAge` to JWT expiry (1 day)
4. **SEC-10** — Strip diag from presign error responses
5. **SEC-11** — Move account state check before bcrypt in student login

### Phase 2 — Small schema/env changes (next sprint)
6. **SEC-06** — Split JWT secret into `JWT_ADMIN_SECRET` + `JWT_STUDENT_SECRET`
7. **SEC-09** — Update `getClientIp` to prefer trusted proxy headers

### Phase 3 — Infrastructure required (planned)
8. **SEC-07** — Redis-backed rate limiter (Upstash recommended for Vercel)
9. **SEC-04** — Token revocation via `jti` deny list (requires Redis)
10. **SEC-05** — CSRF Origin header validation (can be done any time, but lowest risk with Redis in place)

---

## Notes

- SEC-01 and SEC-02 share the same fix. Resolving SEC-01 automatically resolves SEC-02.
- SEC-03, SEC-04, and SEC-07 are architecturally related — the correct long-term solution is refresh token rotation backed by Redis. Phase 1 fixes SEC-03 minimally; Phase 3 completes it properly.
- SEC-06 (split secrets) causes a one-time forced re-login for all users. Schedule at a planned deployment boundary.
- SEC-05 (CSRF) is partially mitigated by `sameSite: lax` today. It becomes critical if the platform ever enables cross-origin embeds or third-party integrations.
