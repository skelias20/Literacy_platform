// app/api/student/daily-tasks/[taskId]/artifact/route.ts
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

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const student = await requireStudent();
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await ctx.params;

  const { searchParams } = new URL(req.url);
  const skill = searchParams.get("skill");

  if (skill !== "reading" && skill !== "speaking") {
    return NextResponse.json({ error: "Invalid skill" }, { status: 400 });
  }

  const submission = await prisma.dailySubmission.findUnique({
    where: { childId_dailyTaskId: { childId: student.childId, dailyTaskId: taskId } },
    select: { id: true, isCompleted: true },
  });

  if (!submission) return NextResponse.json({ ok: true });

  if (submission.isCompleted) {
    return NextResponse.json({ error: "Already submitted." }, { status: 409 });
  }

  await prisma.dailySubmissionArtifact.deleteMany({
    where: { dailySubmissionId: submission.id, skill },
  });

  return NextResponse.json({ ok: true });
}
