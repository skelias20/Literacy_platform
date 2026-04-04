// app/api/admin/assessments/trigger-periodic/route.ts
// Triggers periodic re-evaluation assessments.
// Scope options:
//   { scope: "all" }                          — all active students
//   { scope: "level", level: "foundational" } — all active students at a specific level
//   { scope: "student", childId: "..." }      — single active student (triggered from student detail panel)

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema, IdSchema } from "@/lib/schemas";
import { requireAdminAuth } from "@/lib/serverAuth";
import type { LiteracyLevel } from "@prisma/client";

export const runtime = "nodejs";

const TriggerPeriodicSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("level"), level: LiteracyLevelSchema }),
  z.object({ scope: z.literal("student"), childId: IdSchema }),
]);

export async function POST(req: Request) {
  try {
    const adminId = await requireAdminAuth(req);
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

        // Find the highest cycleNumber for this child's periodic assessments.
        // periodicCycleNumber tracks which re-evaluation cycle (1st, 2nd, 3rd...).
        // sessionNumber within a cycle starts at 1 and increments up to periodicSessionCount.
        const lastCycle = await tx.assessment.findFirst({
          where: { childId: student.id, kind: "periodic" },
          orderBy: { periodicCycleNumber: "desc" },
          select: { periodicCycleNumber: true },
        });
        const nextCycleNumber = (lastCycle?.periodicCycleNumber ?? 0) + 1;

        // Mark previous periodic assessments as not latest
        await tx.assessment.updateMany({
          where: { childId: student.id, kind: "periodic", isLatest: true },
          data: { isLatest: false },
        });

        // Create session 1 of the new cycle
        await tx.assessment.create({
          data: {
            childId: student.id,
            kind: "periodic",
            sessionNumber: 1,
            periodicCycleNumber: nextCycleNumber,
            isLatest: true,
            triggeredByAdminId: adminId,
            // Snapshot the student's current level at trigger time so slot lookups
            // remain stable even if the admin later changes the student's level.
            lookupLevel: (student.level ?? undefined) as LiteracyLevel | undefined,
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