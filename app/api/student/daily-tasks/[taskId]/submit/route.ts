// app/api/student/daily-tasks/[taskId]/submit/route.ts
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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const student = await requireStudent();
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { textResponse: string | null };

  const child = await prisma.child.findUnique({
    where: { id: student.childId },
    select: { id: true, status: true, level: true },
  });
  if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (child.status !== "active") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const task = await prisma.dailyTask.findUnique({
    where: { id: taskId },
    select: { id: true, skill: true, level: true },
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If already submitted => hard block
  const existing = await prisma.dailySubmission.findUnique({
    where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
    select: { id: true, isCompleted: true },
  });
  if (existing?.isCompleted) {
    return NextResponse.json({ error: "Already submitted." }, { status: 409 });
  }

  const now = new Date();

  // Ensure submission exists
  const submission = await prisma.dailySubmission.upsert({
    where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
    update: {},
    create: {
      childId: child.id,
      dailyTaskId: task.id,
      isCompleted: false,
      rpEarned: 0,
    },
    select: { id: true },
  });

  // Done rules:
  if (task.skill === "reading" || task.skill === "speaking") {
    const hasAudio = await prisma.dailySubmissionArtifact.findFirst({
      where: { dailySubmissionId: submission.id, skill: task.skill, fileId: { not: null } },
      select: { id: true },
    });
    if (!hasAudio) {
      return NextResponse.json({ error: "Audio is required." }, { status: 400 });
    }
  } else {
    const text = (body.textResponse ?? "").trim();
    if (text.length === 0) {
      return NextResponse.json({ error: "Text response is required." }, { status: 400 });
    }

    // Replace text artifact
    await prisma.dailySubmissionArtifact.deleteMany({
      where: { dailySubmissionId: submission.id, skill: task.skill },
    });

    await prisma.dailySubmissionArtifact.create({
      data: {
        dailySubmissionId: submission.id,
        skill: task.skill,
        textBody: text,
        fileId: null,
      },
    });
  }

  // Mark completed + RP + child last submission
  const rp = 10;

  await prisma.$transaction([
    prisma.dailySubmission.update({
      where: { id: submission.id },
      data: {
        isCompleted: true,
        submittedAt: now,
        rpEarned: rp,
      },
    }),
    prisma.rpEvent.create({
      data: {
        childId: child.id,
        dailySubmissionId: submission.id,
        delta: rp,
        reason: "daily_completion",
      },
    }),
    prisma.child.update({
      where: { id: child.id },
      data: { lastDailySubmissionAt: now },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
