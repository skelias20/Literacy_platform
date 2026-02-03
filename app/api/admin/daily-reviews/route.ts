// app/api/admin/daily-reviews/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

type AdminJwtPayload = { adminId: string; email: string };

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const SECRET = mustGetEnv("JWT_SECRET");

async function requireAdmin(): Promise<AdminJwtPayload | null> {
  const store = await cookies();
  const token = store.get("admin_token")?.value;
  if (!token) return null;

  const decoded = jwt.verify(token, SECRET);
  if (typeof decoded !== "object" || decoded === null) return null;

  const p = decoded as jwt.JwtPayload;
  const adminId = p.adminId;
  const email = p.email;

  if (typeof adminId !== "string" || typeof email !== "string") return null;
  return { adminId, email };
}

function parseDateOnly(dateStr: string): Date | null {
  // Expect "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  // store as UTC midnight; consistent compare by using same format in queries
  return new Date(`${dateStr}T00:00:00.000Z`);
}

type SkillType = "reading" | "listening" | "writing" | "speaking";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date"); // YYYY-MM-DD
    if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });

    const taskDate = parseDateOnly(date);
    if (!taskDate) return NextResponse.json({ error: "Invalid date format" }, { status: 400 });

    // 1) tasks for that date
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

    const taskIds = tasks.map((t) => t.id);

    // 2) load all submissions for those tasks (includes artifacts)
    const submissions = taskIds.length
      ? await prisma.dailySubmission.findMany({
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
                createdAt: true,
              },
            },
          },
        })
      : [];

    // Helpful index: (taskId -> submissions[])
    const byTask: Record<string, typeof submissions> = {};
    for (const s of submissions) {
      (byTask[s.dailyTaskId] ||= []).push(s);
    }

    // 3) For each task, determine the eligible students (based on task.level)
    // Your schema says DailyTask.level can be null meaning "applies to all levels". :contentReference[oaicite:4]{index=4}
    // We also only want students who are active.
    const result = [];
    for (const t of tasks) {
      const eligibleChildren = await prisma.child.findMany({
        where: {
          status: "active",
          ...(t.level ? { level: t.level } : {}),
        },
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

      // map childId -> submission
      const subMap = new Map<string, (typeof submissions)[number]>();
      for (const s of byTask[t.id] || []) subMap.set(s.childId, s);

      const students = eligibleChildren.map((c) => {
        const s = subMap.get(c.id) || null;
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

      result.push({
        task: {
          id: t.id,
          taskDate: t.taskDate,
          skill: t.skill as SkillType,
          level: t.level,
          createdAt: t.createdAt,
        },
        content: t.contentLinks.map((cl) => cl.contentItem),
        students,
      });
    }

    return NextResponse.json({ date, tasks: result });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "JsonWebTokenError") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
