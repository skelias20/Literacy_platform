// app/api/student/unknown-words/[id]/route.ts
// DELETE — remove a saved word by id (ownership enforced)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

// DELETE /api/student/unknown-words/[id]
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    const student = await requireStudentAuth(req);
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Verify ownership before deleting — a student must not delete another student's word.
    const word = await prisma.unknownWord.findUnique({
      where:  { id },
      select: { childId: true },
    });

    if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (word.childId !== student.childId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.unknownWord.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
