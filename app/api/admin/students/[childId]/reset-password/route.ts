// app/api/admin/students/[childId]/reset-password/route.ts
// POST — admin resets a student's password.
// Returns the plain password ONCE in the response so admin can
// communicate it to the parent via SMS. Never stored in plain text.

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, invalidateStudentSessions } from "@/lib/serverAuth";
import { parseBody } from "@/lib/parseBody";


const ResetPasswordSchema = z.object({
  // Admin can supply a custom password or omit to use a generated one.
  // Min 6, max 64 — simple enough for a child/parent to type from SMS.
  password: z.string().min(6).max(64).optional(),
});

// ── Simple memorable password generator ──────────────────────────────────
// Format: Word + # + 4-digit number e.g. "River#4821"
// Words chosen to be easy to read aloud and spell over the phone.
const WORD_LIST = [
  "River", "Stone", "Cloud", "Flame", "Bloom",
  "Frost", "Grove", "Haven", "Light", "Ocean",
  "Pearl", "Quest", "Raven", "Solar", "Tiger",
  "Unity", "Valor", "Windy", "Amber", "Blaze",
];

function generatePassword(): string {
  const word   = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  const number = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
  return `${word}#${number}`;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ childId: string }> }
) {
  try {
    const adminId = await requireAdminAuth(req);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { childId } = await ctx.params;

    const parsed = parseBody(
      ResetPasswordSchema,
      await req.json().catch(() => ({})),
      "admin/students/reset-password"
    );
    if (!parsed.ok) return parsed.response;

    // Use provided password or generate one
    const plainPassword = parsed.data.password?.trim() || generatePassword();

    // Verify student exists and has credentials (username must be set)
    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, username: true, status: true },
    });

    if (!child) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }
    if (!child.username) {
      return NextResponse.json(
        { error: "Student credentials have not been created yet." },
        { status: 400 }
      );
    }
    if (child.status === "pending_payment" || child.status === "rejected") {
      return NextResponse.json(
        { error: "Cannot reset password for a student in this account state." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);

    await prisma.child.update({
      where: { id: childId },
      data: { passwordHash },
    });

    // SEC-04: Invalidate any active student sessions so the old password's token
    // cannot be reused after the reset. Student must log in with the new credentials.
    await invalidateStudentSessions(childId);

    // Return plain password once — admin communicates to parent via SMS.
    // This is the only time the plain password is ever visible.
    return NextResponse.json({ ok: true, password: plainPassword });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}