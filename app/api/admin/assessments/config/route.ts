// app/api/admin/assessments/config/route.ts
// CHANGE FROM v1: taskFormat removed entirely — format is derived from question bank.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";
import { requireAdminAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

const LEVELS = ["foundational", "functional", "transitional", "advanced"] as const;
const SKILLS = ["reading", "listening", "writing", "speaking"] as const;
const MAX_SESSIONS = 5;

const ConfigPutSchema = z.object({
  initialSessionCount:  z.number().int().min(1).max(MAX_SESSIONS),
  periodicSessionCount: z.number().int().min(1).max(MAX_SESSIONS),
});

async function buildCompletenessMap(
  initialSessionCount: number
): Promise<{
  map: Record<string, Record<string, number>>;
  missingSlots: { level: string; skill: string; sessionNumber: number }[];
}> {
  // Only count slots within the configured session range.
  // Sessions beyond initialSessionCount are hidden in the UI but still exist in the DB.
  // Without this filter, reducing the session count leaves the old session rows counted,
  // producing misleading "2/1" readiness numbers.
  const slots = await prisma.assessmentDefaultContent.findMany({
    where: { sessionNumber: { lte: initialSessionCount } },
    select: { level: true, skill: true, sessionNumber: true },
  });

  const filled: Record<string, Record<string, Set<number>>> = {};
  for (const s of slots) {
    if (!filled[s.level]) filled[s.level] = {};
    if (!filled[s.level][s.skill]) filled[s.level][s.skill] = new Set();
    filled[s.level][s.skill].add(s.sessionNumber);
  }

  const map: Record<string, Record<string, number>> = {};
  const missingSlots: { level: string; skill: string; sessionNumber: number }[] = [];

  for (const level of LEVELS) {
    map[level] = {};
    for (const skill of SKILLS) {
      const filledSet = filled[level]?.[skill] ?? new Set<number>();
      map[level][skill] = filledSet.size;
      for (let n = 1; n <= initialSessionCount; n++) {
        if (!filledSet.has(n)) missingSlots.push({ level, skill, sessionNumber: n });
      }
    }
  }

  return { map, missingSlots };
}

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET() {
  const adminId = await requireAdminAuth();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const config = await prisma.assessmentConfig.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, initialSessionCount: true, periodicSessionCount: true, updatedAt: true },
    });

    const initialSessionCount = config?.initialSessionCount ?? 1;
    const periodicSessionCount = config?.periodicSessionCount ?? 1;
    const { map, missingSlots } = await buildCompletenessMap(initialSessionCount);

    return NextResponse.json({
      config: {
        id: config?.id ?? null,
        initialSessionCount,
        periodicSessionCount,
        updatedAt: config?.updatedAt ?? null,
      },
      completeness: map,
      missingSlots,
      isComplete: missingSlots.length === 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────

export async function PUT(req: Request) {
  const adminId = await requireAdminAuth(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = parseBody(
      ConfigPutSchema,
      await req.json().catch(() => null),
      "assessments/config PUT"
    );
    if (!parsed.ok) return parsed.response;
    const { initialSessionCount, periodicSessionCount } = parsed.data;

    // periodicSessionCount cannot exceed initialSessionCount — they share the same content slots.
    if (periodicSessionCount > initialSessionCount) {
      return NextResponse.json(
        { error: "Periodic sessions per cycle cannot exceed the initial session count." },
        { status: 400 }
      );
    }

    const existing = await prisma.assessmentConfig.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, initialSessionCount: true },
    });

    const currentCount = existing?.initialSessionCount ?? 1;

    if (initialSessionCount > currentCount) {
      const { missingSlots } = await buildCompletenessMap(initialSessionCount);
      if (missingSlots.length > 0) {
        return NextResponse.json(
          {
            error: `Cannot increase to ${initialSessionCount} sessions. The following slots are missing content:`,
            missingSlots,
          },
          { status: 400 }
        );
      }
    }

    let config;
    if (existing?.id) {
      config = await prisma.assessmentConfig.update({
        where: { id: existing.id },
        data: { initialSessionCount, periodicSessionCount, updatedByAdminId: adminId },
        select: { id: true, initialSessionCount: true, periodicSessionCount: true, updatedAt: true },
      });
    } else {
      config = await prisma.assessmentConfig.create({
        data: { initialSessionCount, periodicSessionCount, updatedByAdminId: adminId },
        select: { id: true, initialSessionCount: true, periodicSessionCount: true, updatedAt: true },
      });
    }

    const { map, missingSlots } = await buildCompletenessMap(initialSessionCount);

    return NextResponse.json({
      ok: true,
      config,
      completeness: map,
      missingSlots,
      isComplete: missingSlots.length === 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}