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

function isSkillType(v: string | null): v is SkillType {
  return v === "reading" || v === "listening" || v === "writing" || v === "speaking";
}

export async function DELETE(
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

    const { searchParams } = new URL(req.url);
    const skillParam = searchParams.get("skill");
    if (!isSkillType(skillParam)) {
      return NextResponse.json({ error: "Invalid skill" }, { status: 400 });
    }

    const task = await prisma.dailyTask.findUnique({
      where: { id: taskId },
      select: { id: true, level: true, skill: true },
    });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (task.level !== null && child.level !== task.level) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const submission = await prisma.dailySubmission.findUnique({
      where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
      select: { id: true, isCompleted: true },
    });

    if (!submission) return NextResponse.json({ ok: true }); // nothing to delete
    if (submission.isCompleted) {
      return NextResponse.json({ error: "Already submitted" }, { status: 409 });
    }

    await prisma.dailySubmissionArtifact.deleteMany({
      where: { dailySubmissionId: submission.id, skill: skillParam },
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
