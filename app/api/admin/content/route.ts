// app/api/admin/content/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rateLimit";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema, SkillSchema, IdSchema } from "@/lib/schemas";
import { requireAdminAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

const SKILL_ALLOWED_TYPES: Record<string, string[]> = {
  reading:   ["pdf_document"],
  listening: ["passage_audio"],
  writing:   ["writing_prompt"],
  speaking:  ["speaking_prompt", "passage_audio"],
};
const FILE_REQUIRED_TYPES = ["pdf_document", "passage_audio"];

// ── Schemas ───────────────────────────────────────────────────────────────

const ContentPostSchema = z.object({
  title:       z.string().min(1, "Title required.").max(255).trim(),
  description: z.string().max(500).trim().nullish(),
  skill:       SkillSchema,
  level:       z.union([LiteracyLevelSchema, z.literal("all")]).nullish(),
  type:        z.string().min(1).max(64),
  textBody:    z.string().max(10000).trim().nullish(),
  fileId:      IdSchema.nullish(),
  mimeType:    z.string().max(128).nullish(),
});

const ContentPatchSchema = z.object({
  id:          IdSchema,
  title:       z.string().min(1).max(255).trim().optional(),
  description: z.string().max(500).trim().optional(),
  level:       z.union([LiteracyLevelSchema, z.literal("all")]).optional(),
});

const ContentDeleteSchema = z.object({
  id:    IdSchema,
  force: z.boolean().optional().default(false),
});

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const adminId = await requireAdminAuth();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const skill          = searchParams.get("skill") ?? undefined;
  const level          = searchParams.get("level") ?? undefined;
  const includeDeleted = searchParams.get("includeDeleted") === "true";

  const skillResult = skill ? SkillSchema.safeParse(skill) : null;
  if (skillResult && !skillResult.success) {
    return NextResponse.json({ error: "Invalid skill filter." }, { status: 400 });
  }
  const levelResult = level && level !== "all" ? LiteracyLevelSchema.safeParse(level) : null;
  if (levelResult && !levelResult.success) {
    return NextResponse.json({ error: "Invalid level filter." }, { status: 400 });
  }

  const rawItems = await prisma.contentItem.findMany({
    where: {
      ...(skillResult?.success ? { skill: skillResult.data } : {}),
      ...(levelResult?.success ? { level: levelResult.data } : {}),
      ...(includeDeleted ? {} : { deletedAt: null }),
      // Never expose question bank items directly in the content library list
      type: { not: "questions" },
    },
    select: {
      id: true,
      title: true,
      description: true,
      skill: true,
      level: true,
      type: true,
      textBody: true,
      assetUrl: true,
      mimeType: true,
      deletedAt: true,
      createdAt: true,
      file: {
        select: {
          id: true,
          storageUrl: true,
          originalName: true,
          mimeType: true,
          byteSize: true,
          uploadStatus: true,
        },
      },
      // Include assessment slot assignments so the content library can show badges
      assessmentDefaultSlots: {
        select: { level: true, skill: true, sessionNumber: true },
        orderBy: [{ level: "asc" }, { sessionNumber: "asc" }],
      },
    },
    orderBy: [{ skill: "asc" }, { createdAt: "desc" }],
  });

  const items = rawItems.map((item) => ({
    ...item,
    file: item.file
      ? { ...item.file, byteSize: item.file.byteSize.toString() }
      : null,
  }));

  return NextResponse.json({ items });
}

// ── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit(`admin_content:${ip}`, RATE_LIMITS.adminUpload);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const adminId = await requireAdminAuth(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = parseBody(
      ContentPostSchema,
      await req.json().catch(() => null),
      "admin/content POST"
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const allowedTypes = SKILL_ALLOWED_TYPES[body.skill];
    if (!allowedTypes?.includes(body.type)) {
      return NextResponse.json(
        { error: `Content type "${body.type}" is not valid for the "${body.skill}" skill. Allowed: ${allowedTypes?.join(", ")}.` },
        { status: 400 }
      );
    }
    if (FILE_REQUIRED_TYPES.includes(body.type) && !body.fileId) {
      return NextResponse.json(
        { error: `Content type "${body.type}" requires a file upload.` },
        { status: 400 }
      );
    }

    if (body.fileId) {
      const file = await prisma.file.findUnique({
        where: { id: body.fileId },
        select: { id: true, uploadStatus: true },
      });
      if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
      if (file.uploadStatus !== "COMPLETED") {
        return NextResponse.json(
          { error: "File upload is still processing. Please wait and try again." },
          { status: 400 }
        );
      }
    }

    const levelValue = body.level && body.level !== "all" ? body.level : null;
    const assetUrl   = body.fileId ? `/api/student/content/${body.fileId}` : null;

    const item = await prisma.contentItem.create({
      data: {
        title:            body.title,
        description:      body.description?.trim() || null,
        skill:            body.skill as never,
        level:            levelValue as never,
        type:             body.type as never,
        textBody:         body.textBody?.trim() || null,
        fileId:           body.fileId || null,
        assetUrl,
        mimeType:         body.mimeType || null,
        createdByAdminId: adminId,
      },
    });

    return NextResponse.json({ ok: true, item });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────

export async function PATCH(req: Request) {
  const adminId = await requireAdminAuth(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = parseBody(
      ContentPatchSchema,
      await req.json().catch(() => null),
      "admin/content PATCH"
    );
    if (!parsed.ok) return parsed.response;
    const { id, title, description, level } = parsed.data;

    const item = await prisma.contentItem.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (item.deletedAt) return NextResponse.json({ error: "Cannot edit an archived item." }, { status: 400 });

    const updated = await prisma.contentItem.update({
      where: { id },
      data: {
        ...(title !== undefined              ? { title }                                   : {}),
        ...(description !== undefined        ? { description: description || null }         : {}),
        ...(level !== undefined
          ? { level: level && level !== "all" ? (level as never) : null }
          : {}),
      },
    });

    return NextResponse.json({ ok: true, item: updated });
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
      ContentDeleteSchema,
      await req.json().catch(() => null),
      "admin/content DELETE"
    );
    if (!parsed.ok) return parsed.response;
    const { id, force } = parsed.data;

    const item = await prisma.contentItem.findUnique({
      where: { id },
      select: {
        id: true,
        deletedAt: true,
        title: true,
        fileId: true,
        file: { select: { r2Key: true } },
        dailyTaskLinks: {
          select: {
            dailyTask: { select: { id: true, taskDate: true, skill: true } },
          },
        },
        // Also check if this item is used in assessment slots
        assessmentDefaultSlots: {
          select: { level: true, skill: true, sessionNumber: true },
        },
      },
    });

    if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (item.deletedAt) return NextResponse.json({ error: "Already archived." }, { status: 400 });

    // Block archiving if the item is assigned to any assessment slot
    if (item.assessmentDefaultSlots.length > 0 && !force) {
      return NextResponse.json(
        {
          warning: true,
          message: `This content is assigned to ${item.assessmentDefaultSlots.length} assessment slot(s). Remove it from the assessment configuration first, or pass force: true to archive anyway.`,
          assessmentSlots: item.assessmentDefaultSlots,
        },
        { status: 200 }
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureTasks = item.dailyTaskLinks.filter(
      (l) => new Date(l.dailyTask.taskDate) >= today
    );

    if (futureTasks.length > 0 && !force) {
      return NextResponse.json(
        {
          warning: true,
          message: `This content is linked to ${futureTasks.length} upcoming task(s). Pass force: true to confirm.`,
          affectedTasks: futureTasks.map((l) => ({
            taskId:   l.dailyTask.id,
            taskDate: l.dailyTask.taskDate,
            skill:    l.dailyTask.skill,
          })),
        },
        { status: 200 }
      );
    }

    await prisma.contentItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // R2 object deletion is NOT done synchronously on archive.
    // The Cloudflare Worker orphan-sweep cron handles cleanup by reading File.deletedAt.
    // Setting deletedAt above is sufficient for the sweep to pick it up.

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}