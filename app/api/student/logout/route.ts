// app/api/student/logout/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Clear the student cookie by setting maxAge to 0
  res.cookies.set("student_token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}