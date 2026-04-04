// app/api/admin/assessments/assign-level/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema, IdSchema } from "@/lib/schemas";
import { requireAdminAuth } from "@/lib/serverAuth";
import { sendLevelAssignedEmail } from "@/lib/email";

export const runtime = "nodejs";

const AssignLevelSchema = z.object({
  assessmentId: IdSchema,
  level: LiteracyLevelSchema,
});

export async function POST(req: Request) {
  try {
    const adminId = await requireAdminAuth(req);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(
      AssignLevelSchema,
      await req.json().catch(() => null),
      "assessments/assign-level"
    );
    if (!parsed.ok) return parsed.response;
    const { assessmentId, level } = parsed.data;

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        childId: true,
        kind: true,
        submittedAt: true,
        assignedLevel: true,
        sessionNumber: true,
        child: {
          select: {
            childFirstName: true,
            archivedAt: true,
            parent: { select: { email: true } },
          },
        },
      },
    });

    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    if (!assessment.submittedAt) {
      return NextResponse.json({ error: "Assessment not submitted yet" }, { status: 400 });
    }
    if (assessment.assignedLevel) {
      return NextResponse.json({ error: "Level already assigned" }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.assessment.update({
        where: { id: assessmentId },
        data: {
          assignedLevel: level,
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
        },
      });

      // Always update the child's level — applies to both initial and periodic assessments.
      // For initial: also transition status to active.
      // For periodic: student is already active, just update the level.
      await tx.child.update({
        where: { id: assessment.childId },
        data: {
          level,
          levelAssignedById: adminId,
          levelAssignedAt: new Date(),
          ...(assessment.kind === "initial" ? { status: "active" } : {}),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: assessment.kind === "initial" ? "LEVEL_ASSIGNED" : "LEVEL_CHANGED",
          targetAssessmentId: assessmentId,
          targetChildId: assessment.childId,
          metadata: {
            level,
            kind: assessment.kind,
            sessionNumber: assessment.sessionNumber,
          },
        },
      });
    });

    // Fire notification — fire-and-forget, never blocks the route response.
    // Only send for initial assessments (level assigned for the first time → student goes active).
    // For periodic (level updated), the student is already active — email is still informative.
    void sendLevelAssignedEmail(
      assessment.child.parent.email,
      assessment.child.childFirstName,
      level,
      assessment.child.archivedAt
    ).catch(console.error);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}