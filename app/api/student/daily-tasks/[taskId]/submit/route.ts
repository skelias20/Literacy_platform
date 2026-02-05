// app/api/student/daily-tasks/[taskId]/submit/route.ts
//c
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { SkillType } from "@prisma/client";

export const runtime = "nodejs";

type StudentJwtPayload = { childId: string; username: string };

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

export async function POST(
  req: Request,
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
      select: { id: true, level: true, skill: true },
    });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (task.level !== null && child.level !== task.level) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => null)) as
      | { textResponse?: string | null }
      | null;

    const submission = await prisma.dailySubmission.upsert({
      where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
      update: {},
      create: { childId: child.id, dailyTaskId: task.id },
      select: {
        id: true,
        isCompleted: true,
        artifacts: { select: { skill: true, textBody: true, fileId: true } },
      },
    });

    if (submission.isCompleted) {
      return NextResponse.json({ error: "Already submitted" }, { status: 409 });
    }

    // Attach text artifact for listening/writing at submit time
    if (task.skill === "listening" || task.skill === "writing") {
      const text = (body?.textResponse ?? "").trim();
      if (!text) return NextResponse.json({ error: "Text is required" }, { status: 400 });

      await prisma.dailySubmissionArtifact.deleteMany({
        where: { dailySubmissionId: submission.id, skill: task.skill as SkillType },
      });

      await prisma.dailySubmissionArtifact.create({
        data: {
          dailySubmissionId: submission.id,
          skill: task.skill as SkillType,
          textBody: text,
        },
      });
    }

    // Validate “done means …”
    const artifactsNow = await prisma.dailySubmissionArtifact.findMany({
      where: { dailySubmissionId: submission.id },
      select: { skill: true, textBody: true, fileId: true },
    });

    const skill = task.skill as SkillType;

    const hasAudio = artifactsNow.some((a) => a.skill === skill && !!a.fileId);
    const hasText = artifactsNow.some((a) => a.skill === skill && !!(a.textBody ?? "").trim());

    if (skill === "reading" || skill === "speaking") {
      if (!hasAudio) {
        return NextResponse.json({ error: "Audio recording is required" }, { status: 400 });
      }
    } else {
      if (!hasText) {
        return NextResponse.json({ error: "Text is required" }, { status: 400 });
      }
    }

    // LOCK immediately
    await prisma.dailySubmission.update({
      where: { id: submission.id },
      data: {
        isCompleted: true,
        submittedAt: new Date(),
        rpEarned: 0,
      },
    });

    // Cache for “inactive 24h”
    await prisma.child.update({
      where: { id: child.id },
      data: { lastDailySubmissionAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
