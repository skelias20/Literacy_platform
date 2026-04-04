// app/api/student/daily-tasks/[taskId]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await ctx.params;

    const student = await requireStudentAuth();
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
        taskFormat: true,
        writingMinWords: true,
        writingMaxWords: true,
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
            rpEarned: true,
            artifacts: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                skill: true,
                textBody: true,
                fileId: true,
                answersJson: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (task.level !== null && child.level !== task.level) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Access control: students may only access today's task.
    // A completed (locked) task is always accessible for review regardless of date.
    const submission = task.submissions[0] ?? null;
    if (!submission?.isCompleted) {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const taskDateStr = task.taskDate.toISOString().slice(0, 10);
      if (taskDateStr !== todayStr) {
        return NextResponse.json({ error: "This task is not available today." }, { status: 403 });
      }
    }

    // Strip correctAnswer fields from question bank before sending to student,
    // UNLESS the submission is already completed (locked) — then reveal answers.
    const isLocked = submission?.isCompleted ?? false;

    // Include all content items — including type "questions" (the question bank).
    // The student page's question useMemo finds the listening item whose textBody is
    // a JSON questions payload. The display section hides raw JSON blocks from view.
    // Correct answers are stripped from question bank items when the task is structured
    // and not yet locked — the student should not see answers until the task is complete.
    const isStructuredTask = task.taskFormat === "mcq" || task.taskFormat === "msaq" || task.taskFormat === "fill_blank";

    const contentForStudent = task.contentLinks
      .map((l) => l.contentItem)
      .map((item) => {
        if (item.type === "questions" && isStructuredTask && item.textBody && !isLocked) {
          try {
            const parsed = JSON.parse(item.textBody) as {
              questions: Array<Record<string, unknown>>;
            };
            const stripped = {
              questions: parsed.questions.map((q) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { correctAnswer, correctAnswers, ...safe } = q as Record<string, unknown>;
                void correctAnswer;
                void correctAnswers;
                return safe;
              }),
            };
            return { ...item, textBody: JSON.stringify(stripped) };
          } catch {
            return item;
          }
        }
        return item;
      });

    return NextResponse.json({
      task: {
        id: task.id,
        taskDate: task.taskDate,
        skill: task.skill,
        level: task.level,
        taskFormat: task.taskFormat,
        writingMinWords: task.writingMinWords,
        writingMaxWords: task.writingMaxWords,
      },
      content: contentForStudent,
      existingSubmission: submission
        ? {
            isCompleted: submission.isCompleted,
            submittedAt: submission.submittedAt,
            rpEarned: submission.rpEarned,
            artifacts: submission.artifacts.map((a) => ({
              id: a.id,
              skill: a.skill,
              textBody: a.textBody,
              fileId: a.fileId,
              answersJson: a.answersJson,
            })),
          }
        : null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}