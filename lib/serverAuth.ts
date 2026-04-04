// lib/serverAuth.ts
// Async authentication helpers for API route handlers.
//
// These replace the per-route local requireAdmin / requireStudent helpers and add
// token-version revocation checking: every signed token embeds the current
// tokenVersion from the DB. When the version in the token no longer matches the
// DB value (because archive / password-reset / logout incremented it), the token
// is rejected even if it is otherwise cryptographically valid and not yet expired.
//
// Invalidation triggers:
//   - Student archived               → invalidateStudentSessions(childId)
//   - Student password reset         → invalidateStudentSessions(childId)
//   - Student logout                 → invalidateStudentSessions(childId)
//   - Admin logout                   → invalidateAdminSessions(adminId)

import { cookies } from "next/headers";
import { verifyAdminJwt, verifyStudentJwt, type AdminJwtPayload, type StudentJwtPayload } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isMutationMethod, validateOrigin } from "@/lib/csrf";

// ── Admin helpers ─────────────────────────────────────────────────────────────

/**
 * Extracts and fully validates the admin_token cookie.
 * Returns the adminId string if the token is valid AND its version matches the DB.
 * Returns null on any failure — expired, revoked, bad signature, missing cookie,
 * or CSRF origin mismatch (when req is provided for a mutation method).
 *
 * Pass `req` in mutation handlers (POST/PUT/PATCH/DELETE) to enable CSRF origin
 * checking. Omit for GET handlers — origin validation is skipped automatically.
 */
export async function requireAdminAuth(req?: Request): Promise<string | null> {
  // CSRF guard: reject cross-origin mutation requests before touching cookies or DB.
  if (req && isMutationMethod(req) && !validateOrigin(req)) return null;
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try {
    const payload = verifyAdminJwt(token); // throws on bad sig / exp / shape
    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
      select: { tokenVersion: true },
    });
    if (!admin || admin.tokenVersion !== payload.tokenVersion) return null;
    return payload.adminId;
  } catch {
    return null;
  }
}

/**
 * Increments the admin's tokenVersion, immediately invalidating all active sessions.
 * Call this on logout or any event that should forcibly end admin access.
 */
export async function invalidateAdminSessions(adminId: string): Promise<void> {
  await prisma.admin.update({
    where: { id: adminId },
    data: { tokenVersion: { increment: 1 } },
  });
}

// ── Student helpers ───────────────────────────────────────────────────────────

/**
 * Extracts and fully validates the student_token cookie.
 * Returns the full StudentJwtPayload if the token is valid AND its version matches the DB.
 * Returns null on any failure — expired, revoked, bad signature, missing cookie,
 * or CSRF origin mismatch (when req is provided for a mutation method).
 *
 * Pass `req` in mutation handlers (POST/PUT/PATCH/DELETE) to enable CSRF origin
 * checking. Omit for GET handlers — origin validation is skipped automatically.
 */
export async function requireStudentAuth(req?: Request): Promise<StudentJwtPayload | null> {
  // CSRF guard: reject cross-origin mutation requests before touching cookies or DB.
  if (req && isMutationMethod(req) && !validateOrigin(req)) return null;
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return null;
  try {
    const payload = verifyStudentJwt(token); // throws on bad sig / exp / shape
    const child = await prisma.child.findUnique({
      where: { id: payload.childId },
      select: { tokenVersion: true },
    });
    if (!child || child.tokenVersion !== payload.tokenVersion) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Increments the child's tokenVersion, immediately invalidating all active sessions.
 * Call this whenever a student's account state changes in a way that must end their
 * current session: archive, password reset, or explicit logout.
 */
export async function invalidateStudentSessions(childId: string): Promise<void> {
  await prisma.child.update({
    where: { id: childId },
    data: { tokenVersion: { increment: 1 } },
  });
}

// ── Token-only verifiers (no cookie access, for dual-context routes) ──────────
// Use these in routes like presign/confirm that handle both admin and student tokens
// from cookies they have already extracted themselves.

export async function verifyAdminToken(token: string): Promise<AdminJwtPayload | null> {
  try {
    const payload = verifyAdminJwt(token);
    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
      select: { tokenVersion: true },
    });
    if (!admin || admin.tokenVersion !== payload.tokenVersion) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyStudentToken(token: string): Promise<StudentJwtPayload | null> {
  try {
    const payload = verifyStudentJwt(token);
    const child = await prisma.child.findUnique({
      where: { id: payload.childId },
      select: { tokenVersion: true },
    });
    if (!child || child.tokenVersion !== payload.tokenVersion) return null;
    return payload;
  } catch {
    return null;
  }
}
