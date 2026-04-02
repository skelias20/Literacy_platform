// app/api/student/daily-tasks/[taskId]/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { countWords, normaliseText } from "@/lib/wordCount";
import type { SkillType, TaskFormat } from "@prisma/client";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 5000;

// Platform constant for assessment writing — no per-task config on assessments
export const ASSESSMENT_WRITING_MIN = 3;
export const ASSESSMENT_WRITING_MAX = 800;

// ── Answer types ──────────────────────────────────────────────────────────

type McqQuestion = {
  id: string; type: "mcq"; prompt: string; options: string[]; correctAnswer: string;
};
type MsaqQuestion = {
  id: string; type: "msaq"; prompt: string; answerCount: number; correctAnswers: string[];
};
type FillBlankQuestion = {
  id: string; type: "fill_blank"; prompt: string; correctAnswer: string;
};
type Question = McqQuestion | MsaqQuestion | FillBlankQuestion;

type AnswerEntry =
  | { questionId: string; studentAnswer: string; isCorrect: boolean; correctAnswer: string }
  | { questionId: string; studentAnswers: string[]; correctAnswers: string[]; score: number; maxScore: number };

const DailySubmitSchema = z.object({
  textResponse: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
  // Structured answers for mcq/msaq/fill_blank listening tasks
  answers: z.record(z.string(), z.union([
    z.string(),           // mcq + fill_blank: single string answer
    z.array(z.string()),  // msaq: array of strings
  ])).optional(),
  // Which attempt this is (1–3). Client tracks, server enforces max.
  attemptNumber: z.number().int().min(1).max(3).optional().default(1),
});

// ── Auth ──────────────────────────────────────────────────────────────────

async function requireStudent(): Promise<{ childId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return null;
  try {
    return verifyStudentJwt(token);
  } catch {
    return null;
  }
}

// ── Scoring helpers ───────────────────────────────────────────────────────

function normaliseAnswer(s: string): string {
  return s.trim().toLowerCase();
}

function scoreAnswers(questions: Question[], studentAnswers: Record<string, string | string[]>): AnswerEntry[] {
  return questions.map((q) => {
    if (q.type === "mcq") {
      const student = normaliseAnswer(String(studentAnswers[q.id] ?? ""));
      const correct = normaliseAnswer(q.correctAnswer);
      return { questionId: q.id, studentAnswer: String(studentAnswers[q.id] ?? ""), isCorrect: student === correct, correctAnswer: q.correctAnswer };
    }
    if (q.type === "fill_blank") {
      const student = normaliseAnswer(String(studentAnswers[q.id] ?? ""));
      const correct = normaliseAnswer(q.correctAnswer);
      return { questionId: q.id, studentAnswer: String(studentAnswers[q.id] ?? ""), isCorrect: student === correct, correctAnswer: q.correctAnswer };
    }
    // msaq
    const studentArr = Array.isArray(studentAnswers[q.id])
      ? (studentAnswers[q.id] as string[])
      : [String(studentAnswers[q.id] ?? "")];
    const correctSet = q.correctAnswers.map(normaliseAnswer);
    const score = studentArr.filter((a) => correctSet.includes(normaliseAnswer(a))).length;
    return { questionId: q.id, studentAnswers: studentArr, correctAnswers: q.correctAnswers, score, maxScore: q.correctAnswers.length };
  });
}

// ── POST ──────────────────────────────────────────────────────────────────

export async function POST(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await ctx.params;

    const student = await requireStudent();
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const childId = student.childId;

    const parsed = parseBody(
      DailySubmitSchema,
      await req.json().catch(() => null),
      "daily-tasks/submit"
    );
    if (!parsed.ok) return parsed.response;
    const { textResponse, answers, attemptNumber } = parsed.data;

    // ── Load child + task ─────────────────────────────────────────────────
    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, level: true, status: true },
    });
    if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (child.status !== "active") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const task = await prisma.dailyTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        level: true,
        skill: true,
        rpValue: true,
        taskFormat: true,
        writingMinWords: true,
        writingMaxWords: true,
        contentLinks: {
          select: {
            contentItem: { select: { id: true, type: true, textBody: true } },
          },
        },
      },
    });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (task.level !== null && child.level !== task.level) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const skill = task.skill as SkillType;
    const format = task.taskFormat as TaskFormat;

    // ── Upsert submission ─────────────────────────────────────────────────
    const submission = await prisma.dailySubmission.upsert({
      where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
      update: {},
      create: { childId: child.id, dailyTaskId: task.id },
      select: { id: true, isCompleted: true },
    });

    // ── Lock check: isCompleted set after 3rd attempt ─────────────────────
    if (submission.isCompleted) {
      return NextResponse.json({ error: "Already submitted" }, { status: 409 });
    }

    // ── Skill-specific validation + artifact building ──────────────────────

    let answersJson: AnswerEntry[] | null = null;

    if (skill === "writing") {
      const text = normaliseText(textResponse ?? "");
      if (!text) return NextResponse.json({ error: "Text response is required." }, { status: 400 });

      const wordCount = countWords(text);
      if (task.writingMinWords !== null && task.writingMinWords !== undefined && wordCount < task.writingMinWords) {
        return NextResponse.json({ error: `Response must be at least ${task.writingMinWords} words. You have ${wordCount}.` }, { status: 400 });
      }
      if (task.writingMaxWords !== null && task.writingMaxWords !== undefined && wordCount > task.writingMaxWords) {
        return NextResponse.json({ error: `Response must not exceed ${task.writingMaxWords} words. You have ${wordCount}.` }, { status: 400 });
      }

      await prisma.dailySubmissionArtifact.deleteMany({
        where: { dailySubmissionId: submission.id, skill },
      });
      await prisma.dailySubmissionArtifact.create({
        data: { dailySubmissionId: submission.id, skill, textBody: text },
      });
    }

    else if (skill === "listening") {
      if (format === "free_response") {
        const text = normaliseText(textResponse ?? "");
        if (!text) return NextResponse.json({ error: "Text response is required." }, { status: 400 });

        await prisma.dailySubmissionArtifact.deleteMany({
          where: { dailySubmissionId: submission.id, skill },
        });
        await prisma.dailySubmissionArtifact.create({
          data: { dailySubmissionId: submission.id, skill, textBody: text },
        });
      } else {
        // Structured format.
        // Attempt 1 only: score against the question bank, persist the artifact with correct answers.
        // Attempts 2 and 3 are scored client-side against the correct answers returned from attempt 1.
        // The server only needs to handle the lock on attempt 3 — no artifact write needed.
        if ((attemptNumber ?? 1) === 1) {
          if (!answers || Object.keys(answers).length === 0) {
            return NextResponse.json({ error: "Answers are required." }, { status: 400 });
          }

          // Find specifically the question bank content item — type must be "questions".
          // Cannot use .find((c) => c.textBody) because other content items (audio prompts,
          // speaking prompts) may also have a textBody. Only the question bank has type "questions".
          const listeningContent = task.contentLinks
            .map((l) => l.contentItem)
            .find((c) => c.type === "questions" && c.textBody);

          if (!listeningContent?.textBody) {
            return NextResponse.json({ error: "No question bank found for this task." }, { status: 500 });
          }

          let questions: Question[];
          try {
            const bank = JSON.parse(listeningContent.textBody) as { questions: Question[] };
            questions = bank.questions;
          } catch {
            return NextResponse.json({ error: "Invalid question bank format." }, { status: 500 });
          }

          answersJson = scoreAnswers(questions, answers);

          await prisma.dailySubmissionArtifact.deleteMany({
            where: { dailySubmissionId: submission.id, skill },
          });
          await prisma.dailySubmissionArtifact.create({
            data: {
              dailySubmissionId: submission.id,
              skill,
              answersJson: answersJson as object[],
            },
          });
        }
        // Attempts 2+: no artifact write — client scores locally and sends only a lock request on attempt 3
      }
    }

    else if (skill === "reading" || skill === "speaking") {
      // Audio artifact must have been uploaded via presign/confirm already
      const audioArtifact = await prisma.dailySubmissionArtifact.findFirst({
        where: { dailySubmissionId: submission.id, skill, fileId: { not: null } },
      });
      if (!audioArtifact) {
        return NextResponse.json({ error: "Audio recording is required." }, { status: 400 });
      }
    }

    // ── Determine whether this submission locks the task ──────────────────
    //
    // Lock rules by skill + format:
    //   reading, speaking        → always lock (audio, no retry)
    //   writing                  → always lock (no retry)
    //   listening + free_response → always lock (no retry)
    //   listening + structured   → lock only on 3rd attempt; attempts 1–2 save but stay open
    //
    // The retry mechanism belongs exclusively to structured listening.
    // Writing and free-response listening have no retry — they lock on first submission.
    //
    // TODO (future): Move attempts 2 and 3 for structured listening to client-side scoring.
    // Attempt 1 → server (persist answersJson to DB). Attempts 2–3 → score locally against
    // correct answers returned from attempt 1. Lock call → server (isCompleted = true).
    // This avoids unnecessary server round-trips and DB writes for intermediate attempts.
    // RP award rules:
    //   All non-structured skills  → award on lock (same call)
    //   Structured listening       → award on attempt 1 (when artifact is persisted to DB).
    //                                Attempt 3 only sets isCompleted — RP already awarded.
    const isStructuredListening = skill === "listening" && format !== "free_response";
    const shouldLock    = isStructuredListening ? (attemptNumber ?? 1) >= 3 : true;
    const shouldAwardRp = isStructuredListening ? (attemptNumber ?? 1) === 1 : true;

    const rp = task.rpValue ?? 10;

    if (shouldLock && shouldAwardRp) {
      // Non-structured skills: lock + award RP in one step
      await prisma.dailySubmission.update({
        where: { id: submission.id },
        data: { isCompleted: true, submittedAt: new Date(), rpEarned: rp },
      });
      await prisma.rpEvent.create({
        data: { childId: child.id, dailySubmissionId: submission.id, delta: rp, reason: "daily_completion" },
      });
      await prisma.child.update({
        where: { id: child.id },
        data: { lastDailySubmissionAt: new Date() },
      });
    } else if (shouldLock) {
      // Structured listening attempt 3: lock only — RP already awarded at attempt 1
      await prisma.dailySubmission.update({
        where: { id: submission.id },
        data: { isCompleted: true },
      });
    } else if (shouldAwardRp) {
      // Structured listening attempt 1: award RP + set submittedAt — but don't lock yet
      await prisma.dailySubmission.update({
        where: { id: submission.id },
        data: { submittedAt: new Date(), rpEarned: rp },
      });
      await prisma.rpEvent.create({
        data: { childId: child.id, dailySubmissionId: submission.id, delta: rp, reason: "daily_completion" },
      });
      await prisma.child.update({
        where: { id: child.id },
        data: { lastDailySubmissionAt: new Date() },
      });
    }
    // Note: shouldLock=false + shouldAwardRp=false (attempt 2) never reaches the server —
    // attempt 2 is scored entirely client-side. This branch is unreachable in normal flow.

    return NextResponse.json({
      ok: true,
      locked: shouldLock,
      rpEarned: shouldAwardRp ? rp : 0,
      answersJson: answersJson ?? undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}