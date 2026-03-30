// app/api/admin/daily-reviews/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";

export const runtime = "nodejs";

async function requireAdmin(): Promise<string | null> {
  const store = await cookies();
  const token = store.get("admin_token")?.value;
  if (!token) return null;
  try {
    return verifyAdminJwt(token).adminId;
  } catch {
    return null;
  }
}

function parseDateOnly(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export async function GET(req: Request) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });

    const taskDate = parseDateOnly(date);
    if (!taskDate) return NextResponse.json({ error: "Invalid date format" }, { status: 400 });

    // ── 1. Load all tasks for the date ────────────────────────────────────
    const tasks = await prisma.dailyTask.findMany({
      where: { taskDate },
      orderBy: [{ skill: "asc" }, { createdAt: "asc" }],
      include: {
        contentLinks: {
          include: {
            contentItem: {
              select: {
                id: true,
                title: true,
                description: true,
                skill: true,
                type: true,
                level: true,
                assetUrl: true,
                mimeType: true,
              },
            },
          },
        },
      },
    });

    if (tasks.length === 0) {
      return NextResponse.json({ date, tasks: [] });
    }

    const taskIds = tasks.map((t) => t.id);

    // ── 2. Load all submissions for those tasks in one query ──────────────
    const submissions = await prisma.dailySubmission.findMany({
      where: { dailyTaskId: { in: taskIds } },
      include: {
        child: {
          select: {
            id: true,
            childFirstName: true,
            childLastName: true,
            username: true,
            status: true,
            level: true,
          },
        },
        artifacts: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            skill: true,
            textBody: true,
            fileId: true,
            answersJson: true, // structured Q&A for mcq/msaq/fill_blank submissions
            createdAt: true,
          },
        },
      },
    });

    // Index submissions by taskId for O(1) lookup
    const byTask = new Map<string, typeof submissions>();
    for (const s of submissions) {
      const existing = byTask.get(s.dailyTaskId) ?? [];
      existing.push(s);
      byTask.set(s.dailyTaskId, existing);
    }

    // ── 3. Load all eligible active students in ONE query ─────────────────
    // Fetch all active students, then filter per-task in memory.
    // This replaces the N+1 pattern (one query per task inside a loop).
    const allActiveStudents = await prisma.child.findMany({
      where: { status: "active", archivedAt: null },
      select: {
        id: true,
        childFirstName: true,
        childLastName: true,
        username: true,
        status: true,
        level: true,
      },
      orderBy: [{ childFirstName: "asc" }, { childLastName: "asc" }],
    });

    // ── 4. Build result — no more per-task DB queries ─────────────────────
    const result = tasks.map((t) => {
      // Filter eligible students for this task in memory
      const eligibleChildren = t.level
        ? allActiveStudents.filter((c) => c.level === t.level)
        : allActiveStudents;

      const taskSubmissions = byTask.get(t.id) ?? [];
      const subMap = new Map(taskSubmissions.map((s) => [s.childId, s]));

      const students = eligibleChildren.map((c) => {
        const s = subMap.get(c.id) ?? null;
        return {
          child: c,
          submission: s
            ? {
                id: s.id,
                submittedAt: s.submittedAt,
                isCompleted: s.isCompleted,
                rpEarned: s.rpEarned,
                artifacts: s.artifacts,
              }
            : null,
        };
      });

      return {
        task: {
          id: t.id,
          taskDate: t.taskDate,
          skill: t.skill,
          level: t.level,
          createdAt: t.createdAt,
        },
        content: t.contentLinks.map((cl) => cl.contentItem),
        students,
      };
    });

    return NextResponse.json({ date, tasks: result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}