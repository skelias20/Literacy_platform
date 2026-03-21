// app/api/student/login/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signStudentJwt } from "@/lib/auth";
import { rateLimit, getClientIp, RATE_LIMITS, formatRetryAfter } from "@/lib/rateLimit";
import { parseBody } from "@/lib/parseBody";

const StudentLoginSchema = z.object({
  username: z.string().min(1).max(64).trim(),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  try {
    // ── Rate limit ────────────────────────────────────────────────────────
    const ip = getClientIp(req);
    const rl = rateLimit(`student_login:${ip}`, RATE_LIMITS.studentLogin);
    if (!rl.allowed) {
      const wait = formatRetryAfter(rl.retryAfterMs);
      return NextResponse.json(
        { error: `Too many login attempts. Please try again in ${wait}.` },
        { status: 429 }
      );
    }

    // ── Parse + validate input ────────────────────────────────────────────
    const parsed = parseBody(StudentLoginSchema, await req.json(), "student/login");
    if (!parsed.ok) return parsed.response;
    const { username, password } = parsed.data;

    // ── Credentials check ─────────────────────────────────────────────────
    const child = await prisma.child.findUnique({ where: { username } });

    if (!child || !child.passwordHash) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, child.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    // ── Account state checks ──────────────────────────────────────────────
    // Check archived first — gives a clear message rather than generic 403
    if (child.archivedAt) {
      return NextResponse.json(
        { error: "This account has been deactivated. Please contact the administrator." },
        { status: 403 }
      );
    }

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