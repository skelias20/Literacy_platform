// app/api/admin/content/[contentItemId]/question-bank/route.ts
// FIX: removed isAssessmentDefault: false from contentItem.create call.
// That field was removed from the schema in the v2 migration.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";

export const runtime = "nodejs";

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

const QuestionBankPutSchema = z.object({
  taskFormat: z.enum(["mcq", "msaq", "fill_blank"]),
  questions:  z.array(AnyQuestionSchema).min(1).max(50),
}).refine(
  (data) => {
    for (const q of data.questions) {
      if (q.type === "mcq" && !q.options.includes(q.correctAnswer)) return false;
    }
    return true;
  },
  { message: "MCQ correct answer must match one of the provided options." }
);

async function requireAdmin(): Promise<string | null> {
  const store = await cookies();
  const token = store.get("admin_token")?.value;
  if (!token) return null;
  try { return verifyAdminJwt(token).adminId; }
  catch { return null; }
}

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ contentItemId: string }> }
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { contentItemId } = await ctx.params;

    const audio = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: {
        id: true, skill: true, type: true, deletedAt: true,
        questionBank: {
          select: { id: true, textBody: true, deletedAt: true },
        },
      },
    });

    if (!audio) return NextResponse.json({ error: "Content item not found." }, { status: 404 });
    if (audio.deletedAt) return NextResponse.json({ error: "Content item is archived." }, { status: 410 });
    if (audio.skill !== "listening") {
      return NextResponse.json({ error: "Question banks only apply to listening content." }, { status: 400 });
    }

    if (!audio.questionBank || audio.questionBank.deletedAt) {
      return NextResponse.json({ questionBank: null });
    }

    let parsed: { questions: unknown[] } | null = null;
    try {
      parsed = JSON.parse(audio.questionBank.textBody ?? "null");
    } catch {
      return NextResponse.json({ error: "Question bank data is corrupt." }, { status: 500 });
    }

    return NextResponse.json({
      questionBank: { id: audio.questionBank.id, ...parsed },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ contentItemId: string }> }
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { contentItemId } = await ctx.params;

    const parsed = parseBody(
      QuestionBankPutSchema,
      await req.json().catch(() => null),
      "content/question-bank PUT"
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const audio = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: {
        id: true, skill: true, type: true, level: true, deletedAt: true,
        questionBank: { select: { id: true, deletedAt: true } },
      },
    });

    if (!audio) return NextResponse.json({ error: "Content item not found." }, { status: 404 });
    if (audio.deletedAt) return NextResponse.json({ error: "Content item is archived." }, { status: 410 });
    if (audio.skill !== "listening") {
      return NextResponse.json({ error: "Question banks only apply to listening content." }, { status: 400 });
    }

    const bankJson = JSON.stringify({ questions: body.questions });

    if (audio.questionBank && !audio.questionBank.deletedAt) {
      await prisma.contentItem.update({
        where: { id: audio.questionBank.id },
        data: { textBody: bankJson },
      });
      return NextResponse.json({ ok: true, action: "updated", questionBankId: audio.questionBank.id });
    }

    // Create a new question bank ContentItem linked to this audio.
    // isAssessmentDefault removed — field no longer exists on ContentItem.
    const newBank = await prisma.contentItem.create({
      data: {
        title:               `Question bank for: ${contentItemId}`,
        skill:               "listening",
        type:                "questions",
        level:               audio.level,
        textBody:            bankJson,
        createdByAdminId:    adminId,
        parentContentItemId: contentItemId,
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, action: "created", questionBankId: newBank.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}