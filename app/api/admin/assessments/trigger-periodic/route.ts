// app/api/admin/assessments/trigger-periodic/route.ts
// Triggers periodic re-evaluation assessments.
// Scope options:
//   { scope: "all" }                          — all active students
//   { scope: "level", level: "foundational" } — all active students at a specific level
//   { scope: "student", childId: "..." }      — single active student (triggered from student detail panel)

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema, IdSchema } from "@/lib/schemas";

export const runtime = "nodejs";

const TriggerPeriodicSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("level"), level: LiteracyLevelSchema }),
  z.object({ scope: z.literal("student"), childId: IdSchema }),
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
    let targetStudents: { id: string; level: string | null }[];

    if (body.scope === "student") {
      const child = await prisma.child.findFirst({
        where: { id: body.childId, status: "active", archivedAt: null },
        select: { id: true, level: true },
      });
      if (!child) {
        return NextResponse.json(
          { error: "Student not found or not eligible for a periodic assessment." },
          { status: 404 }
        );
      }
      targetStudents = [child];
    } else {
      targetStudents = await prisma.child.findMany({
        where: {
          status: "active",
          archivedAt: null,
          ...(body.scope === "level" ? { level: body.level } : {}),
        },
        select: { id: true, level: true },
      });

      if (targetStudents.length === 0) {
        return NextResponse.json(
          { error: "No active students found for the selected scope." },
          { status: 400 }
        );
      }
    }

    // ── Create periodic assessment for each target student ────────────────
    // Each student gets one new periodic session.
    // If they already have an open (unsubmitted) periodic assessment, skip them
    // to avoid creating duplicates.
    const created: string[] = [];
    const skipped: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const student of targetStudents) {
        // Check for existing open periodic assessment.
        // Must match isLatest: true — orphaned rows (isLatest: false, submittedAt: null)
        // from stale bulk triggers should not block a new trigger.
        const existing = await tx.assessment.findFirst({
          where: {
            childId: student.id,
            kind: "periodic",
            isLatest: true,
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
            // Snapshot the student's current level at trigger time so slot lookups
            // remain stable even if the admin later changes the student's level.
            lookupLevel: student.level ?? undefined,
          },
        });

        created.push(student.id);
      }

      // Audit log — one entry for the trigger action
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "PERIODIC_TRIGGERED",
          metadata: {
            scope: body.scope,
            ...(body.scope === "level" ? { level: body.level } : {}),
            ...(body.scope === "student" ? { childId: body.childId } : {}),
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