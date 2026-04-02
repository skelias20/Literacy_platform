// app/api/student/assessment/submit/route.ts
// CHANGE FROM v1: when creating the next session row, taskFormat is derived
// from the listening slot's question bank for that session number,
// not from AssessmentConfig.taskFormat (which no longer exists).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyStudentJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { IdSchema } from "@/lib/schemas";
import { countWords, normaliseText } from "@/lib/wordCount";
import type { TaskFormat } from "@prisma/client";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 5000;
const ASSESSMENT_WRITING_MIN = 3;
const ASSESSMENT_WRITING_MAX = 800;

type McqQuestion  = { id: string; type: "mcq";        prompt: string; options: string[];   correctAnswer: string   };
type MsaqQuestion = { id: string; type: "msaq";       prompt: string; answerCount: number; correctAnswers: string[] };
type FillQuestion = { id: string; type: "fill_blank"; prompt: string;                      correctAnswer: string   };
type Question = McqQuestion | MsaqQuestion | FillQuestion;

type AnswerEntry =
  | { questionId: string; studentAnswer: string;   isCorrect: boolean; correctAnswer: string }
  | { questionId: string; studentAnswers: string[]; correctAnswers: string[]; score: number; maxScore: number };

const AssessmentSubmitSchema = z.object({
  assessmentId: IdSchema,
  responses: z.object({
    listening: z.string().max(MAX_TEXT_LENGTH).trim().optional(),
    writing:   z.string().max(MAX_TEXT_LENGTH).trim().optional(),
  }).optional(),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});

function normaliseAnswer(s: string): string {
  return s.trim().toLowerCase();
}

function scoreAnswers(
  questions: Question[],
  studentAnswers: Record<string, string | string[]>
): AnswerEntry[] {
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
    const studentArr = Array.isArray(studentAnswers[q.id])
      ? (studentAnswers[q.id] as string[])
      : [String(studentAnswers[q.id] ?? "")];
    const correctSet = q.correctAnswers.map(normaliseAnswer);
    const score = studentArr.filter((a) => correctSet.includes(normaliseAnswer(a))).length;
    return { questionId: q.id, studentAnswers: studentArr, correctAnswers: q.correctAnswers, score, maxScore: q.correctAnswers.length };
  });
}

// Derive TaskFormat from a question bank text body.
function deriveFormatFromBank(textBody: string | null): TaskFormat {
  if (!textBody) return "free_response";
  try {
    const bank = JSON.parse(textBody) as { questions: Array<{ type: string }> };
    const firstType = bank.questions?.[0]?.type;
    if (firstType === "mcq" || firstType === "msaq" || firstType === "fill_blank") return firstType as TaskFormat;
  } catch { /* fall through */ }
  return "free_response";
}

export async function POST(req: Request) {
  try {
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

    const parsed = parseBody(
      AssessmentSubmitSchema,
      await req.json().catch(() => null),
      "assessment/submit"
    );
    if (!parsed.ok) return parsed.response;
    const { assessmentId, responses, answers } = parsed.data;

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true, childId: true, kind: true,
        submittedAt: true, taskFormat: true, sessionNumber: true,
        periodicCycleNumber: true,
        lookupLevel: true,
        child: { select: { status: true, level: true } },
      },
    });

    if (!assessment || assessment.childId !== childId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (assessment.submittedAt) {
      return NextResponse.json({ error: "Assessment already submitted" }, { status: 409 });
    }

    // Use the level stored at assessment creation time — matches what the GET route showed the student.
    // Old rows (pre-migration) fall back to "foundational" for initial, assigned level for periodic.
    const effectiveLevel = assessment.lookupLevel
      ?? (assessment.kind === "initial" ? "foundational" : (assessment.child.level ?? "foundational"));

    // sessionNumber maps directly to the content slot for both kinds.
    const slotSessionNumber = assessment.sessionNumber;

    const format = assessment.taskFormat as TaskFormat;
    const isStructured = format === "mcq" || format === "msaq" || format === "fill_blank";

    const writingText = normaliseText(responses?.writing ?? "");
    if (writingText) {
      const wc = countWords(writingText);
      if (wc < ASSESSMENT_WRITING_MIN) {
        return NextResponse.json(
          { error: `Writing response must be at least ${ASSESSMENT_WRITING_MIN} words. You have ${wc}.` },
          { status: 400 }
        );
      }
      if (wc > ASSESSMENT_WRITING_MAX) {
        return NextResponse.json(
          { error: `Writing response must not exceed ${ASSESSMENT_WRITING_MAX} words. You have ${wc}.` },
          { status: 400 }
        );
      }
    }

    // Always fetch the listening slot — needed for contentItemId audit trail (DESIGN-1)
    // and for question bank scoring when the format is structured.
    const listeningSlot = await prisma.assessmentDefaultContent.findUnique({
      where: {
        level_skill_sessionNumber: {
          level: effectiveLevel,
          skill: "listening",
          sessionNumber: slotSessionNumber,
        },
      },
      select: {
        contentItemId: true,
        contentItem: {
          select: {
            questionBank: { select: { textBody: true, deletedAt: true } },
          },
        },
      },
    });

    // Fetch writing slot for contentItemId audit trail.
    const writingSlot = await prisma.assessmentDefaultContent.findUnique({
      where: {
        level_skill_sessionNumber: {
          level: effectiveLevel,
          skill: "writing",
          sessionNumber: slotSessionNumber,
        },
      },
      select: { contentItemId: true },
    });


    let listeningAnswersJson: AnswerEntry[] | null = null;

    if (isStructured) {
      if (!answers || Object.keys(answers).length === 0) {
        return NextResponse.json({ error: "Listening answers are required." }, { status: 400 });
      }

      const bankText = listeningSlot?.contentItem?.questionBank;
      if (!bankText || bankText.deletedAt || !bankText.textBody) {
        return NextResponse.json(
          { error: "No question bank found for this assessment session." },
          { status: 500 }
        );
      }

      let questions: Question[];
      try {
        const bank = JSON.parse(bankText.textBody) as { questions: Question[] };
        questions = bank.questions;
      } catch {
        return NextResponse.json({ error: "Invalid question bank format." }, { status: 500 });
      }

      listeningAnswersJson = scoreAnswers(questions, answers);
    }

    const config = await prisma.assessmentConfig.findFirst({
      orderBy: { createdAt: "asc" },
      select: { initialSessionCount: true, periodicSessionCount: true },
    });
    const initialSessionCount  = config?.initialSessionCount  ?? 1;
    const periodicSessionCount = config?.periodicSessionCount ?? 1;

    const isLastSession =
      assessment.kind === "initial"
        ? assessment.sessionNumber >= initialSessionCount
        : assessment.sessionNumber >= periodicSessionCount;

    // For next session creation: derive format from the NEXT session's listening slot.
    let nextSessionFormat: TaskFormat = "free_response";
    if (!isLastSession) {
      const nextSessionNumber = assessment.sessionNumber + 1;
      const nextListeningSlot = await prisma.assessmentDefaultContent.findUnique({
        where: {
          level_skill_sessionNumber: {
            level: effectiveLevel,
            skill: "listening",
            sessionNumber: nextSessionNumber,
          },
        },
        select: {
          contentItem: {
            select: {
              questionBank: { select: { textBody: true, deletedAt: true } },
            },
          },
        },
      });
      const nextQb = nextListeningSlot?.contentItem?.questionBank;
      nextSessionFormat = (!nextQb || nextQb.deletedAt)
        ? "free_response"
        : deriveFormatFromBank(nextQb.textBody);
    }

    await prisma.$transaction(async (tx) => {
      await tx.assessmentArtifact.deleteMany({
        where: { assessmentId: assessment.id, fileId: null },
      });

      if (writingText) {
        await tx.assessmentArtifact.create({
          data: {
            assessmentId: assessment.id,
            skill: "writing",
            textBody: writingText,
            contentItemId: writingSlot?.contentItemId ?? null,
          },
        });
      }

      if (isStructured && listeningAnswersJson) {
        await tx.assessmentArtifact.create({
          data: {
            assessmentId: assessment.id,
            skill: "listening",
            answersJson: listeningAnswersJson as object[],
            contentItemId: listeningSlot?.contentItemId ?? null,
          },
        });
      } else {
        const listeningText = normaliseText(responses?.listening ?? "");
        if (listeningText) {
          await tx.assessmentArtifact.create({
            data: {
              assessmentId: assessment.id,
              skill: "listening",
              textBody: listeningText,
              contentItemId: listeningSlot?.contentItemId ?? null,
            },
          });
        }
      }

      await tx.assessment.update({
        where: { id: assessment.id },
        data: { submittedAt: new Date() },
      });

      if (isLastSession) {
        if (assessment.kind === "initial") {
          await tx.child.update({
            where: { id: childId },
            data: { status: "pending_level_review" },
          });
        }
        // Periodic last session: child stays active — no status change.
      } else {
        const nextSessionNumber = assessment.sessionNumber + 1;

        await tx.assessment.updateMany({
          where: { childId, kind: assessment.kind, isLatest: true },
          data: { isLatest: false },
        });

        await tx.assessment.create({
          data: {
            childId,
            kind: assessment.kind,
            sessionNumber: nextSessionNumber,
            isLatest: true,
            startedAt: null,
            taskFormat: nextSessionFormat,
            // Propagate lookupLevel so all sessions in the same cycle use the same level band.
            lookupLevel: assessment.lookupLevel,
            // Propagate cycleNumber for periodic so all sessions in the cycle are grouped together.
            ...(assessment.kind === "periodic"
              ? { periodicCycleNumber: assessment.periodicCycleNumber }
              : {}),
          },
        });
      }
    });

    return NextResponse.json({
      ok: true,
      isLastSession,
      nextSessionNumber: isLastSession ? null : assessment.sessionNumber + 1,
      answersJson: listeningAnswersJson ?? undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}