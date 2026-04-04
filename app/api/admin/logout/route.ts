// app/api/admin/logout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { invalidateAdminSessions } from "@/lib/serverAuth";

export async function POST() {
  // Revoke the session in the DB before clearing the cookie.
  // This ensures the token cannot be reused even if the client
  // retains a copy (e.g., from a compromised device or network capture).
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (token) {
    try {
      const payload = verifyAdminJwt(token);
      await invalidateAdminSessions(payload.adminId);
    } catch {
      // Token already invalid or expired — no revocation needed
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
