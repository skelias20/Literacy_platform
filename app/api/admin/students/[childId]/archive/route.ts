// app/api/admin/students/[childId]/archive/route.ts
// POST — toggles archivedAt on a student record.
// Archiving is a soft operation — no data is deleted.
// An archived student cannot log in but all their data is preserved.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try {
    return verifyAdminJwt(token).adminId;
  } catch {
    return null;
  }
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ childId: string }> }
) {
  try {
    const adminId = await requireAdmin();
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

    return NextResponse.json({
      ok: true,
      archived: !isCurrentlyArchived,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}