// app/api/admin/students/[childId]/archive/route.ts
// POST — toggles archivedAt on a student record.
// Archiving is a soft operation — no data is deleted.
// An archived student cannot log in but all their data is preserved.
// SEC-04: When archiving, the student's tokenVersion is incremented to
// immediately invalidate any active sessions — no 24-hour grace window.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, invalidateStudentSessions } from "@/lib/serverAuth";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ childId: string }> }
) {
  try {
    const adminId = await requireAdminAuth(req);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { childId } = await ctx.params;

    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, archivedAt: true },
    });

    if (!child) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }

    const isCurrentlyArchived = !!child.archivedAt;

    // Toggle: archive if active, unarchive if already archived
    await prisma.child.update({
      where: { id: childId },
      data: { archivedAt: isCurrentlyArchived ? null : new Date() },
    });

    // Invalidate any active student sessions when archiving.
    // Unarchiving does NOT invalidate — the student must log in fresh anyway.
    if (!isCurrentlyArchived) {
      await invalidateStudentSessions(childId);
    }

    return NextResponse.json({
      ok: true,
      archived: !isCurrentlyArchived,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
