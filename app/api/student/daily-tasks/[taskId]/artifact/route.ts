import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SkillType } from "@prisma/client";
import { requireStudentAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

function isSkillType(v: string | null): v is SkillType {
  return v === "reading" || v === "listening" || v === "writing" || v === "speaking";
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await ctx.params;

    const student = await requireStudentAuth(req);
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
