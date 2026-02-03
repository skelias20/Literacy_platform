// app/api/student/daily-tasks/[taskId]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await ctx.params;

    const student = await requireStudent();
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const child = await prisma.child.findUnique({
      where: { id: student.childId },
      select: { id: true, level: true, status: true },
    });
    if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (child.status !== "active") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const task = await prisma.dailyTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        taskDate: true,
        skill: true,
        level: true,
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
        submissions: {
          where: { childId: child.id },
          select: {
            id: true,
            isCompleted: true,
            submittedAt: true,
            artifacts: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                skill: true,
                textBody: true,
                fileId: true,
                createdAt: true,
                // keep file select if you want; client ignores extra fields
                file: { select: { id: true, originalName: true, mimeType: true } },
              },
            },
          },
        },
      },
    });

    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Must match level (or task is global)
    if (task.level !== null && child.level !== task.level) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const submission = task.submissions[0] ?? null;

    // ✅ Return EXACT shape the page expects: { task, content, existingSubmission }
    return NextResponse.json({
      task: {
        id: task.id,
        taskDate: task.taskDate,
        skill: task.skill,
        level: task.level,
      },
      content: task.contentLinks.map((l) => l.contentItem),
      existingSubmission: submission
        ? {
            isCompleted: submission.isCompleted,
            submittedAt: submission.submittedAt,
            artifacts: submission.artifacts.map((a) => ({
              id: a.id,
              skill: a.skill,
              textBody: a.textBody,
              fileId: a.fileId,
            })),
          }
        : null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
