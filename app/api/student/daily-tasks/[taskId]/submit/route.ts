// app/api/student/daily-tasks/[taskId]/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { SkillType } from "@prisma/client";

export const runtime = "nodejs";

// Max text length for listening/writing responses
const MAX_TEXT_LENGTH = 5000;

const DailySubmitSchema = z.object({
  // textResponse is only required for listening/writing tasks.
  // For reading/speaking tasks the client sends null — Zod accepts that.
  textResponse: z.string().max(MAX_TEXT_LENGTH).trim().nullable().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await ctx.params;

    // ── Auth — use canonical verifier, not inline jwt.verify ─────────────
    const cookieStore = await cookies();
    const token = cookieStore.get("student_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let childId: string;
    try {
      const payload = verifyStudentJwt(token);
      childId = payload.childId;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Parse + validate input ────────────────────────────────────────────
    const parsed = parseBody(
      DailySubmitSchema,
      await req.json().catch(() => null),
      "daily-tasks/submit"
    );
    if (!parsed.ok) return parsed.response;
    const { textResponse } = parsed.data;

    // ── Load child + task ─────────────────────────────────────────────────
    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, level: true, status: true },
    });
    if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (child.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const task = await prisma.dailyTask.findUnique({
      where: { id: taskId },
      select: { id: true, level: true, skill: true, rpValue: true },
    });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (task.level !== null && child.level !== task.level) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ── Upsert submission record ──────────────────────────────────────────
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

    const skill = task.skill as SkillType;

    // ── Attach text artifact for listening/writing ────────────────────────
    if (skill === "listening" || skill === "writing") {
      const text = (textResponse ?? "").trim();
      if (!text) {
        return NextResponse.json({ error: "Text response is required." }, { status: 400 });
      }
      await prisma.dailySubmissionArtifact.deleteMany({
        where: { dailySubmissionId: submission.id, skill },
      });
      await prisma.dailySubmissionArtifact.create({
        data: { dailySubmissionId: submission.id, skill, textBody: text },
      });
    }

    // ── Verify required artifact is present ──────────────────────────────
    const artifactsNow = await prisma.dailySubmissionArtifact.findMany({
      where: { dailySubmissionId: submission.id },
      select: { skill: true, textBody: true, fileId: true },
    });

    const hasAudio = artifactsNow.some((a) => a.skill === skill && !!a.fileId);
    const hasText  = artifactsNow.some((a) => a.skill === skill && !!(a.textBody ?? "").trim());

    if (skill === "reading" || skill === "speaking") {
      if (!hasAudio) {
        return NextResponse.json({ error: "Audio recording is required." }, { status: 400 });
      }
    } else {
      if (!hasText) {
        return NextResponse.json({ error: "Text response is required." }, { status: 400 });
      }
    }

    // ── Lock submission + award RP ────────────────────────────────────────
    const rp = task.rpValue ?? 10;

    await prisma.dailySubmission.update({
      where: { id: submission.id },
      data: { isCompleted: true, submittedAt: new Date(), rpEarned: rp },
    });

    await prisma.rpEvent.create({
      data: {
        childId: child.id,
        dailySubmissionId: submission.id,
        delta: rp,
        reason: "daily_completion",
      },
    });

    // Update last activity timestamp for inactivity monitor
    await prisma.child.update({
      where: { id: child.id },
      data: { lastDailySubmissionAt: new Date() },
    });

    return NextResponse.json({ ok: true, rpEarned: rp });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}