// app/api/admin/assessments/trigger-periodic/route.ts
// Triggers periodic re-evaluation assessments for a cohort.
// Scope options:
//   { scope: "all" }                          — all active students
//   { scope: "level", level: "foundational" } — all active students at a specific level
//
// Future student-level trigger (not built yet — architecture note):
//   { scope: "student", childId: "..." }
//   Same underlying logic — just a single childId instead of a level query.
//   Add a button on /admin/students/[childId] detail panel that calls this route
//   with scope: "student". No schema changes needed.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema } from "@/lib/schemas";

export const runtime = "nodejs";

const TriggerPeriodicSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("level"), level: LiteracyLevelSchema }),
  // student scope is intentionally not implemented yet — see file header comment
]);

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

export async function POST(req: Request) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(
      TriggerPeriodicSchema,
      await req.json().catch(() => null),
      "assessments/trigger-periodic"
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // ── Find target students ──────────────────────────────────────────────
    const targetStudents = await prisma.child.findMany({
      where: {
        status: "active",
        archivedAt: null,
        ...(body.scope === "level" ? { level: body.level } : {}),
      },
      select: { id: true },
    });

    if (targetStudents.length === 0) {
      return NextResponse.json(
        { error: "No active students found for the selected scope." },
        { status: 400 }
      );
    }

    // ── Create periodic assessment for each target student ────────────────
    // Each student gets one new periodic session.
    // If they already have an open (unsubmitted) periodic assessment, skip them
    // to avoid creating duplicates.
    const created: string[] = [];
    const skipped: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const student of targetStudents) {
        // Check for existing open periodic assessment
        const existing = await tx.assessment.findFirst({
          where: {
            childId: student.id,
            kind: "periodic",
            submittedAt: null,
          },
          select: { id: true },
        });

        if (existing) {
          skipped.push(student.id);
          continue;
        }

        // Find next session number for this student's periodic assessments
        const lastPeriodic = await tx.assessment.findFirst({
          where: { childId: student.id, kind: "periodic" },
          orderBy: { sessionNumber: "desc" },
          select: { sessionNumber: true },
        });
        const nextSession = (lastPeriodic?.sessionNumber ?? 0) + 1;

        // Mark previous periodic assessments as not latest
        await tx.assessment.updateMany({
          where: { childId: student.id, kind: "periodic", isLatest: true },
          data: { isLatest: false },
        });

        await tx.assessment.create({
          data: {
            childId: student.id,
            kind: "periodic",
            sessionNumber: nextSession,
            isLatest: true,
            triggeredByAdminId: adminId,
          },
        });

        created.push(student.id);
      }

      // Audit log — one entry for the trigger action
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "LEVEL_CHANGED", // closest existing action — TODO: add PERIODIC_TRIGGERED to enum
          metadata: {
            scope: body.scope,
            ...(body.scope === "level" ? { level: body.level } : {}),
            studentsTriggered: created.length,
            studentsSkipped: skipped.length,
          },
        },
      });
    });

    return NextResponse.json({
      ok: true,
      triggered: created.length,
      skipped: skipped.length,
      message: skipped.length > 0
        ? `${created.length} assessment(s) created. ${skipped.length} student(s) skipped — they already have an open periodic assessment.`
        : `${created.length} periodic assessment(s) created successfully.`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}