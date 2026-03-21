// middleware.ts
// Protects /admin/* and /student/* routes.
// Checks cookie existence AND JWT validity.
// Distinguishes expired tokens from missing/invalid ones so the login page
// can show a "session expired" message instead of a generic redirect.
//
// NOTE: lib/auth.ts is NOT imported here because middleware runs on the
// Next.js edge runtime and cannot use Node.js crypto APIs that jsonwebtoken
// depends on in some configurations. Instead we do a minimal manual JWT
// expiry check using the standard atob/TextDecoder available on the edge.
// The full cryptographic verification still happens in every API route handler
// via verifyStudentJwt / verifyAdminJwt — middleware is the UX layer only.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Decode JWT payload without verifying signature.
// Used ONLY to check the exp claim for redirect UX purposes.
// Signature verification always happens server-side in API route handlers.
function decodeJwtExpiry(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // Base64url → base64 → JSON
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload);
    const obj = JSON.parse(json) as Record<string, unknown>;
    return typeof obj.exp === "number" ? obj.exp : null;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const exp = decodeJwtExpiry(token);
  if (exp === null) return false; // can't tell — let API route handle it
  return Date.now() / 1000 > exp;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow Next internals + static assets + public files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/assessment/") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  // ── Student auth ──────────────────────────────────────────────────────────
  const isStudentLogin = pathname === "/student/login";
  const isStudentRoute = pathname.startsWith("/student");

  if (isStudentRoute && !isStudentLogin) {
    const token = req.cookies.get("student_token")?.value;
    const url = req.nextUrl.clone();
    url.pathname = "/student/login";

    if (!token) {
      return NextResponse.redirect(url);
    }
    if (isTokenExpired(token)) {
      url.searchParams.set("expired", "1");
      const res = NextResponse.redirect(url);
      // Clear the stale cookie so middleware doesn't loop
      res.cookies.delete("student_token");
      return res;
    }
  }

  // ── Admin auth ────────────────────────────────────────────────────────────
  const isAdminLogin = pathname === "/admin/login";
  const isAdminRoute = pathname.startsWith("/admin");

  if (isAdminRoute && !isAdminLogin) {
    const token = req.cookies.get("admin_token")?.value;
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";

    if (!token) {
      return NextResponse.redirect(url);
    }
    if (isTokenExpired(token)) {
      url.searchParams.set("expired", "1");
      const res = NextResponse.redirect(url);
      res.cookies.delete("admin_token");
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};