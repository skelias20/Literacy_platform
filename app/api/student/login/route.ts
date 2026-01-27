import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { signStudentJwt } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 }
      );
    }

    const child = await prisma.child.findUnique({ where: { username } });

    if (!child || !child.passwordHash) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, child.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    // Only allow login if admin has created credentials
    if (
      child.status === "pending_payment" ||
      child.status === "approved_pending_login" ||
      child.status === "rejected"
    ) {
      return NextResponse.json(
        { error: "Account not ready for login." },
        { status: 403 }
      );
    }

    const token = signStudentJwt({ childId: child.id, username });

    const res = NextResponse.json({ ok: true });
    res.cookies.set("student_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
