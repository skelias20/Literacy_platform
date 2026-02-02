// app/api/student/daily-tasks/[taskId]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
const SECRET = mustGetEnv("JWT_SECRET");

type StudentJwtPayload = { childId: string; username: string };

async function requireStudent(): Promise<StudentJwtPayload | null> {
  const store = await cookies();
  const token = store.get("student_token")?.value;
  if (!token) return null;

  const decoded = jwt.verify(token, SECRET);
  if (typeof decoded !== "object" || decoded === null) return null;

  const p = decoded as jwt.JwtPayload;
  const childId = p.childId;
  const username = p.username;

  if (typeof childId !== "string" || typeof username !== "string") return null;
  return { childId, username };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const student = await requireStudent();
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await ctx.params;

  const child = await prisma.child.findUnique({
    where: { id: student.childId },
    select: { id: true, status: true, level: true },
  });

  if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (child.status !== "active") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const task = await prisma.dailyTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      skill: true,
      level: true,
      taskDate: true,
      contentLinks: {
        select: {
          contentItem: {
            select: {
              id: true,
              title: true,
              description: true,
              skill: true,
              type: true,
              textBody: true,
              assetUrl: true,
              mimeType: true,
            },
          },
        },
      },
    },
  });

  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // level gating: tasks with level null apply to all
  if (task.level && child.level && task.level !== child.level) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (task.level && !child.level) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existingSubmission = await prisma.dailySubmission.findUnique({
    where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
    select: {
      isCompleted: true,
      submittedAt: true,
      artifacts: { select: { id: true, skill: true, textBody: true, fileId: true } },
    },
  });

  return NextResponse.json({
    task: { id: task.id, skill: task.skill, level: task.level, taskDate: task.taskDate },
    content: task.contentLinks.map((x) => x.contentItem),
    existingSubmission,
  });
}
