// app/api/admin/login/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signAdminJwt } from "@/lib/auth";
import { rateLimit, getClientIp, RATE_LIMITS, formatRetryAfter } from "@/lib/rateLimit";
import { parseBody } from "@/lib/parseBody";

const AdminLoginSchema = z.object({
  email: z.string().email().max(254).trim().toLowerCase(),
  // max 128 to prevent DoS via bcrypt on huge strings
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  try {
    // ── Rate limit ────────────────────────────────────────────────────────
    const ip = getClientIp(req);
    const rl = rateLimit(`admin_login:${ip}`, RATE_LIMITS.adminLogin);
    if (!rl.allowed) {
      const wait = formatRetryAfter(rl.retryAfterMs);
      return NextResponse.json(
        { error: `Too many login attempts. Please try again in ${wait}.` },
        { status: 429 }
      );
    }

    // ── Parse + validate input ────────────────────────────────────────────
    const parsed = parseBody(AdminLoginSchema, await req.json(), "admin/login");
    if (!parsed.ok) return parsed.response;
    const { email, password } = parsed.data;

    // ── Credentials check ─────────────────────────────────────────────────
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const token = signAdminJwt({ adminId: admin.id, email: admin.email });

    const res = NextResponse.json({ ok: true });
    res.cookies.set("admin_token", token, {
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