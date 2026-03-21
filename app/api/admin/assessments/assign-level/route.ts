// app/api/admin/assessments/assign-level/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema, IdSchema } from "@/lib/schemas";

const AssignLevelSchema = z.object({
  assessmentId: IdSchema,
  level: LiteracyLevelSchema,
});

export async function POST(req: Request) {
  try {
    // ── Auth — use canonical verifier, not inline jwt.verify ─────────────
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let adminId: string;
    try {
      const payload = verifyAdminJwt(token);
      adminId = payload.adminId;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Parse + validate input ────────────────────────────────────────────
    const parsed = parseBody(
      AssignLevelSchema,
      await req.json().catch(() => null),
      "assessments/assign-level"
    );
    if (!parsed.ok) return parsed.response;
    const { assessmentId, level } = parsed.data;

    // ── Business logic checks ─────────────────────────────────────────────
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, childId: true, submittedAt: true, assignedLevel: true },
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

    // ── Atomic update ─────────────────────────────────────────────────────
    await prisma.$transaction(async (tx) => {
      await tx.assessment.update({
        where: { id: assessmentId },
        data: {
          assignedLevel: level,
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
        },
      });

      await tx.child.update({
        where: { id: assessment.childId },
        data: {
          level,
          status: "active",
          levelAssignedById: adminId,
          levelAssignedAt: new Date(),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "LEVEL_ASSIGNED",
          targetAssessmentId: assessmentId,
          targetChildId: assessment.childId,
          metadata: { level },
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}