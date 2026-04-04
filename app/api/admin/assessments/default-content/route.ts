// app/api/admin/assessments/default-content/route.ts
// DELETE enforces replace-not-clear for initial session slots:
// if sessionNumber <= initialSessionCount, clearing is rejected (409).
// Admins must POST replacement content instead of clearing.
// Slots beyond initialSessionCount (hidden sessions) can be freely deleted.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema, SkillSchema, IdSchema } from "@/lib/schemas";
import { requireAdminAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

const SlotPostSchema = z.object({
  level:         LiteracyLevelSchema,
  skill:         SkillSchema,
  sessionNumber: z.number().int().min(1).max(5),
  contentItemId: IdSchema,
});

const SlotDeleteSchema = z.object({
  level:         LiteracyLevelSchema,
  skill:         SkillSchema,
  sessionNumber: z.number().int().min(1).max(5),
});

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET() {
  const adminId = await requireAdminAuth();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const slots = await prisma.assessmentDefaultContent.findMany({
      orderBy: [{ level: "asc" }, { skill: "asc" }, { sessionNumber: "asc" }],
      select: {
        id: true, level: true, skill: true, sessionNumber: true,
        contentItem: {
          select: {
            id: true, title: true, skill: true, type: true,
            level: true, assetUrl: true, mimeType: true, deletedAt: true,
            questionBank: { select: { id: true, deletedAt: true } },
          },
        },
      },
    });

    const nonListeningContent = await prisma.contentItem.findMany({
      where: {
        deletedAt: null,
        type: { not: "questions" },
        skill: { not: "listening" },
      },
      orderBy: [{ skill: "asc" }, { level: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, title: true, skill: true, type: true,
        level: true, assetUrl: true, mimeType: true,
        questionBank: { select: { id: true, deletedAt: true } },
      },
    });

    const listeningContent = await prisma.contentItem.findMany({
      where: {
        deletedAt: null,
        skill: "listening",
        type: "passage_audio",
        questionBank: { deletedAt: null },
      },
      orderBy: [{ level: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, title: true, skill: true, type: true,
        level: true, assetUrl: true, mimeType: true,
        questionBank: { select: { id: true, deletedAt: true } },
      },
    });

    const availableContent = [...nonListeningContent, ...listeningContent];
    return NextResponse.json({ slots, availableContent });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const adminId = await requireAdminAuth(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = parseBody(
      SlotPostSchema,
      await req.json().catch(() => null),
      "assessments/default-content POST"
    );
    if (!parsed.ok) return parsed.response;
    const { level, skill, sessionNumber, contentItemId } = parsed.data;

    const item = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: {
        id: true, skill: true, deletedAt: true,
        questionBank: { select: { id: true, deletedAt: true } },
      },
    });
    if (!item) return NextResponse.json({ error: "Content item not found." }, { status: 404 });
    if (item.deletedAt) return NextResponse.json({ error: "Content item is archived." }, { status: 400 });
    if (item.skill !== skill) {
      return NextResponse.json(
        { error: `Content item skill "${item.skill}" does not match slot skill "${skill}".` },
        { status: 400 }
      );
    }
    if (skill === "listening" && (!item.questionBank || item.questionBank.deletedAt)) {
      return NextResponse.json(
        { error: "This listening audio has no question bank. Author one first." },
        { status: 400 }
      );
    }

    const existing = await prisma.assessmentDefaultContent.findUnique({
      where: { level_skill_sessionNumber: { level, skill, sessionNumber } },
      select: { id: true },
    });

    let slot;
    if (existing) {
      slot = await prisma.assessmentDefaultContent.update({
        where: { id: existing.id },
        data: { contentItemId, createdByAdminId: adminId },
        select: { id: true, level: true, skill: true, sessionNumber: true, contentItemId: true },
      });
    } else {
      slot = await prisma.assessmentDefaultContent.create({
        data: { level, skill, sessionNumber, contentItemId, createdByAdminId: adminId },
        select: { id: true, level: true, skill: true, sessionNumber: true, contentItemId: true },
      });
    }

    return NextResponse.json({ ok: true, slot });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  const adminId = await requireAdminAuth(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = parseBody(
      SlotDeleteSchema,
      await req.json().catch(() => null),
      "assessments/default-content DELETE"
    );
    if (!parsed.ok) return parsed.response;
    const { level, skill, sessionNumber } = parsed.data;

    // Block clearing slots that are within the required session range.
    // New students registering at any time must always have content available for their grade band.
    // Admins must replace content (POST) rather than clear it.
    const config = await prisma.assessmentConfig.findFirst({
      orderBy: { createdAt: "asc" },
      select: { initialSessionCount: true },
    });
    const initialSessionCount = config?.initialSessionCount ?? 1;

    if (sessionNumber <= initialSessionCount) {
      return NextResponse.json(
        {
          error:
            "Initial assessment slots cannot be left empty. Assign replacement content instead of clearing.",
        },
        { status: 409 }
      );
    }

    const existing = await prisma.assessmentDefaultContent.findUnique({
      where: { level_skill_sessionNumber: { level, skill, sessionNumber } },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Slot not found." }, { status: 404 });

    await prisma.assessmentDefaultContent.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}