import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SkillType } from "@prisma/client";
import { requireStudentAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

function dateOnlyUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function GET() {
  try {
    const student = await requireStudentAuth();
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const child = await prisma.child.findUnique({
      where: { id: student.childId },
      select: { id: true, level: true, status: true },
    });

    if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Only active users should do daily tasks
    if (child.status !== "active") {
      return NextResponse.json({ tasks: [], blocked: true, reason: "not_active" });
    }

    const today = dateOnlyUTC(new Date());

    // Tasks for child's level OR tasks for all levels (level = null)
    const tasks = await prisma.dailyTask.findMany({
      where: {
        taskDate: today,
        OR: [{ level: child.level ?? undefined }, { level: null }],
      },
      select: {
        id: true,
        taskDate: true,
        skill: true,
        level: true,
        submissions: {
          where: { childId: child.id },
          select: { id: true, isCompleted: true, submittedAt: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const normalized = tasks.map((t) => {
      const sub = t.submissions[0] ?? null;
      return {
        id: t.id,
        taskDate: t.taskDate,
        skill: t.skill,
        level: t.level,
        isCompleted: sub?.isCompleted ?? false,
        submittedAt: sub?.submittedAt ?? null,
      };
    });

    // Student page expects "tasks"
    return NextResponse.json({ tasks: normalized });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
