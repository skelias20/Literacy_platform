// lib/auth.ts
// Central JWT signing and verification for admin and student tokens.
// All API route handlers must use the typed helpers here — never call
// jwt.verify() directly in route files.
//
// Middleware (middleware.ts) does NOT import this file. It does a
// signature-free payload decode using atob() to stay on the Edge runtime,
// which cannot reliably use Node.js crypto libraries. Full cryptographic
// verification always happens here, in API route handlers only.

import jwt, { JwtPayload } from "jsonwebtoken";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in environment variables`);
  return v;
}

const JWT_ADMIN_SECRET = requireEnv("JWT_ADMIN_SECRET");
const JWT_STUDENT_SECRET = requireEnv("JWT_STUDENT_SECRET");
const JWT_ALGORITHM = "HS256" as const;

// ── Token payload types ───────────────────────────────────────────────────
// role is included as an explicit claim so tokens are self-describing.
// Verification checks the role field — a student token cannot pass admin
// verification even if the field shapes happen to match.

export type AdminJwtPayload = {
  adminId: string;
  email: string;
  role: "admin";
  tokenVersion: number;
};

export type StudentJwtPayload = {
  childId: string;
  username: string;
  role: "student";
  tokenVersion: number;
};

// ── Signing ───────────────────────────────────────────────────────────────

export function signAdminJwt(payload: Omit<AdminJwtPayload, "role">): string {
  return jwt.sign(
    { ...payload, role: "admin" },
    JWT_ADMIN_SECRET,
    { algorithm: JWT_ALGORITHM, expiresIn: "1d" }
  );
}

export function signStudentJwt(payload: Omit<StudentJwtPayload, "role">): string {
  return jwt.sign(
    { ...payload, role: "student" },
    JWT_STUDENT_SECRET,
    { algorithm: JWT_ALGORITHM, expiresIn: "1d" }
  );
}

// ── Throwing verifiers (for API route handlers) ───────────────────────────
// These throw on any failure — expired, invalid, wrong role, bad shape.
// Callers catch and return 401.

export function verifyAdminJwt(token: string): AdminJwtPayload {
  const decoded = jwt.verify(token, JWT_ADMIN_SECRET, { algorithms: [JWT_ALGORITHM] });

  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token payload");
  }

  const obj = decoded as JwtPayload;

  if (
    typeof obj.adminId !== "string" ||
    typeof obj.email !== "string" ||
    obj.role !== "admin" ||
    typeof obj.tokenVersion !== "number"
  ) {
    throw new Error("Invalid token payload shape");
  }

  return { adminId: obj.adminId, email: obj.email, role: "admin", tokenVersion: obj.tokenVersion };
}

export function verifyStudentJwt(token: string): StudentJwtPayload {
  const decoded = jwt.verify(token, JWT_STUDENT_SECRET, { algorithms: [JWT_ALGORITHM] });

  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token payload");
  }

  const obj = decoded as JwtPayload;

  if (
    typeof obj.childId !== "string" ||
    typeof obj.username !== "string" ||
    obj.role !== "student" ||
    typeof obj.tokenVersion !== "number"
  ) {
    throw new Error("Invalid token payload shape");
  }

  return { childId: obj.childId, username: obj.username, role: "student", tokenVersion: obj.tokenVersion };
}

// ── Safe verifiers (non-throwing, for future API route use) ───────────────
// Returns a typed result instead of throwing. Use these when you want to
// branch on expired vs invalid vs missing rather than catching a generic error.
// Middleware does NOT use these — see comment at top of file.

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "invalid" | "missing" };

export function verifyAdminTokenSafe(token: string | undefined): VerifyResult {
  if (!token) return { ok: false, reason: "missing" };
  try {
    const decoded = jwt.verify(token, JWT_ADMIN_SECRET, {
      algorithms: [JWT_ALGORITHM],
    }) as JwtPayload;
    if (
      typeof decoded.adminId !== "string" ||
      typeof decoded.email !== "string" ||
      decoded.role !== "admin"
    ) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

export function verifyStudentTokenSafe(token: string | undefined): VerifyResult {
  if (!token) return { ok: false, reason: "missing" };
  try {
    const decoded = jwt.verify(token, JWT_STUDENT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    }) as JwtPayload;
    if (
      typeof decoded.childId !== "string" ||
      typeof decoded.username !== "string" ||
      decoded.role !== "student"
    ) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}