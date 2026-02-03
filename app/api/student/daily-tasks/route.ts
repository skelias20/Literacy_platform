import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { SkillType } from "@prisma/client";

export const runtime = "nodejs";

type StudentJwtPayload = {
  childId: string;
  username: string;
};

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
const SECRET = mustGetEnv("JWT_SECRET");

function dateOnlyUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function requireStudent(): Promise<StudentJwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return null;

  const decoded = jwt.verify(token, SECRET);
  if (typeof decoded !== "object" || decoded === null) return null;

  const payload = decoded as jwt.JwtPayload;
  const childId = payload.childId;
  const username = payload.username;

  if (typeof childId !== "string" || typeof username !== "string") return null;
  return { childId, username };
}

export async function GET() {
  try {
    const student = await requireStudent();
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
