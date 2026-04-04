// app/api/admin/daily-tasks/route.ts
// isAssessmentDefault removed from all contentItem.create calls — field no longer exists.
// All other logic is unchanged.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema, SkillSchema, IdSchema } from "@/lib/schemas";
import { requireAdminAuth } from "@/lib/serverAuth";
import { sendTaskCreatedEmail } from "@/lib/email";

export const runtime = "nodejs";

const TaskFormatSchema = z.enum(["free_response", "mcq", "msaq", "fill_blank"]);

const DateQuerySchema = z.object({
  date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  level: z.string().optional(),
});

const McqQuestionSchema = z.object({
  id:            z.string().min(1).max(64),
  type:          z.literal("mcq"),
  prompt:        z.string().min(1).max(1000).trim(),
  options:       z.array(z.string().min(1).max(200).trim()).min(2).max(6),
  correctAnswer: z.string().min(1).max(200).trim(),
});

const MsaqQuestionSchema = z.object({
  id:             z.string().min(1).max(64),
  type:           z.literal("msaq"),
  prompt:         z.string().min(1).max(1000).trim(),
  answerCount:    z.number().int().min(1).max(6),
  correctAnswers: z.array(z.string().min(1).max(200).trim()).min(1).max(6),
});

const FillBlankQuestionSchema = z.object({
  id:            z.string().min(1).max(64),
  type:          z.literal("fill_blank"),
  prompt:        z.string().min(1).max(1000).trim(),
  correctAnswer: z.string().min(1).max(200).trim(),
});

const AnyQuestionSchema = z.discriminatedUnion("type", [
  McqQuestionSchema,
  MsaqQuestionSchema,
  FillBlankQuestionSchema,
]);

const QuestionBankSchema = z.object({
  questions: z.array(AnyQuestionSchema).min(1).max(50),
});

const DailyTaskPostSchema = z.object({
  date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  level: z.union([LiteracyLevelSchema, z.literal("all")]),
  skills: z.array(SkillSchema).min(1, "Select at least one skill.").max(4),
  contentBySkill: z.record(SkillSchema, z.array(IdSchema).max(20)).optional(),
  rpValue: z.number().int().min(5).max(20),
  taskFormat: TaskFormatSchema.optional().default("free_response"),
  writingMinWords: z.number().int().min(1).max(2000).nullish(),
  writingMaxWords: z.number().int().min(1).max(5000).nullish(),
  questionBank: QuestionBankSchema.optional(),
}).refine(
  (data) => {
    if (data.writingMinWords && data.writingMaxWords) {
      return data.writingMinWords < data.writingMaxWords;
    }
    return true;
  },
  { message: "Minimum word count must be less than maximum word count.", path: ["writingMinWords"] }
).refine(
  (data) => {
    if (
      data.skills.includes("listening") &&
      data.taskFormat !== "free_response" &&
      !data.questionBank
    ) {
      return false;
    }
    return true;
  },
  { message: "A question bank is required for structured listening tasks.", path: ["questionBank"] }
).refine(
  (data) => {
    if (!data.questionBank) return true;
    for (const q of data.questionBank.questions) {
      if (q.type === "mcq" && !q.options.includes(q.correctAnswer)) return false;
    }
    return true;
  },
  { message: "MCQ correct answer must match one of the provided options.", path: ["questionBank"] }
);

function parseDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const adminId = await requireAdminAuth();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const rawParams = {
      date:  searchParams.get("date") ?? undefined,
      level: searchParams.get("level") ?? undefined,
    };

    const parsed = parseBody(DateQuerySchema, rawParams, "admin/daily-tasks GET");
    if (!parsed.ok) return parsed.response;
    const { date, level } = parsed.data;

    const taskDate = parseDateOnly(date);

    const levelFilter =
      level && level !== "all"
        ? LiteracyLevelSchema.safeParse(level).success
          ? (level as z.infer<typeof LiteracyLevelSchema>)
          : null
        : null;

    const content = await prisma.contentItem.findMany({
      where: {
        deletedAt: null,
        type: { not: "questions" },
        ...(levelFilter
          ? { OR: [{ level: levelFilter }, { level: null }] }
          : {}),
      },
      select: {
        id: true,
        title: true,
        description: true,
        skill: true,
        type: true,
        level: true,
      },
      orderBy: [{ skill: "asc" }, { createdAt: "desc" }],
    });

    const tasks = await prisma.dailyTask.findMany({
      where: {
        taskDate,
        ...(levelFilter ? { level: levelFilter } : {}),
      },
      select: {
        id: true,
        taskDate: true,
        skill: true,
        level: true,
        rpValue: true,
        taskFormat: true,
        writingMinWords: true,
        writingMaxWords: true,
        contentLinks: {
          select: {
            contentItemId: true,
            contentItem: { select: { id: true, title: true, skill: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ content, tasks });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const adminId = await requireAdminAuth(req);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(
      DailyTaskPostSchema,
      await req.json().catch(() => null),
      "admin/daily-tasks POST"
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const taskDate   = parseDateOnly(body.date);

    // Reject past dates — daily tasks must be created for today or a future date.
    const todayUtc = parseDateOnly(new Date().toISOString().slice(0, 10));
    if (taskDate < todayUtc) {
      return NextResponse.json({ error: "Daily tasks cannot be created for past dates." }, { status: 400 });
    }

    const levelValue = body.level !== "all" ? body.level : null;
    const skills     = Array.from(new Set(body.skills));

    const allContentIds = skills
      .flatMap((s) => body.contentBySkill?.[s] ?? [])
      .filter(Boolean);

    if (allContentIds.length > 0) {
      const contentItems = await prisma.contentItem.findMany({
        where: { id: { in: allContentIds }, deletedAt: null },
        select: { id: true, skill: true },
      });
      const contentSkillMap = new Map(contentItems.map((c) => [c.id, c.skill]));

      for (const skill of skills) {
        const ids = body.contentBySkill?.[skill] ?? [];
        for (const id of ids) {
          const actualSkill = contentSkillMap.get(id);
          if (!actualSkill) {
            return NextResponse.json({ error: `Content item ${id} not found or archived.` }, { status: 400 });
          }
          if (actualSkill !== skill) {
            return NextResponse.json(
              { error: `Content item "${id}" has skill "${actualSkill}" but was assigned to a "${skill}" task.` },
              { status: 400 }
            );
          }
        }
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const results: { skill: string; taskId: string }[] = [];

      for (const skill of skills) {
        const taskFormat      = skill === "listening" ? body.taskFormat : "free_response";
        const writingMinWords = skill === "writing" ? (body.writingMinWords ?? null) : null;
        const writingMaxWords = skill === "writing" ? (body.writingMaxWords ?? null) : null;

        const task = await tx.dailyTask.create({
          data: {
            taskDate,
            skill,
            level: levelValue,
            rpValue: body.rpValue,
            taskFormat,
            writingMinWords,
            writingMaxWords,
            createdByAdminId: adminId,
          },
          select: { id: true },
        });

        const contentIds = (body.contentBySkill?.[skill] ?? []).filter(Boolean);
        let questionBankContentItemId: string | null = null;

        if (skill === "listening" && body.taskFormat !== "free_response" && body.questionBank) {
          const selectedAudioId = contentIds[0];
          if (!selectedAudioId) {
            throw new Error("A listening audio content item must be selected for structured tasks.");
          }

          const bankJson = JSON.stringify({ questions: body.questionBank.questions });

          const audio = await tx.contentItem.findUnique({
            where: { id: selectedAudioId },
            select: {
              id: true,
              level: true,
              questionBank: { select: { id: true, deletedAt: true } },
            },
          });
          if (!audio) throw new Error(`Audio content item ${selectedAudioId} not found.`);

          if (audio.questionBank && !audio.questionBank.deletedAt) {
            await tx.contentItem.update({
              where: { id: audio.questionBank.id },
              data: { textBody: bankJson },
            });
            questionBankContentItemId = audio.questionBank.id;
          } else {
            const newBank = await tx.contentItem.create({
              data: {
                title:               `Question bank for: ${selectedAudioId}`,
                skill:               "listening",
                type:                "questions",
                level:               audio.level,
                textBody:            bankJson,
                // isAssessmentDefault removed — field no longer exists on ContentItem
                createdByAdminId:    adminId,
                parentContentItemId: selectedAudioId,
              },
              select: { id: true },
            });
            questionBankContentItemId = newBank.id;
          }
        }

        const finalContentIds = [
          ...contentIds,
          ...(questionBankContentItemId ? [questionBankContentItemId] : []),
        ];

        if (finalContentIds.length > 0) {
          await tx.dailyTaskContent.createMany({
            data: finalContentIds.map((contentItemId) => ({ dailyTaskId: task.id, contentItemId })),
            skipDuplicates: true,
          });
        }

        const eligibleChildren = await tx.child.findMany({
          where: { status: "active", ...(levelValue ? { level: levelValue } : {}) },
          select: { id: true },
        });

        if (eligibleChildren.length > 0) {
          await tx.dailySubmission.createMany({
            data: eligibleChildren.map((c) => ({ childId: c.id, dailyTaskId: task.id })),
            skipDuplicates: true,
          });
        }

        results.push({ skill, taskId: task.id });
      }

      return results;
    });

    // Event 3 — Notify parents of eligible students (fan-out, fire-and-forget).
    // Runs OUTSIDE the transaction so we never hold a DB tx open during N HTTP calls.
    // Only fires when skills were actually created and the date is today or future
    // (past dates are already blocked above, so this guard is a safety net only).
    if (created.length > 0) {
      void (async () => {
        try {
          const eligibleWithParents = await prisma.child.findMany({
            where: {
              status: "active",
              archivedAt: null,
              ...(levelValue ? { level: levelValue } : {}),
            },
            select: {
              childFirstName: true,
              archivedAt: true,
              parent: { select: { email: true } },
            },
          });

          const skillNames = created.map((r) => r.skill);

          for (const child of eligibleWithParents) {
            void sendTaskCreatedEmail(
              child.parent.email,
              child.childFirstName,
              skillNames,
              body.date,
              child.archivedAt
            ).catch(console.error);
          }
        } catch (err) {
          console.error("[email] Task created fan-out failed:", err);
        }
      })();
    }

    return NextResponse.json({ ok: true, created });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}