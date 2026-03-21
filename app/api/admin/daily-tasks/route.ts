// app/api/admin/daily-tasks/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { LiteracyLevelSchema, SkillSchema, IdSchema } from "@/lib/schemas";

export const runtime = "nodejs";

// ── Schemas ───────────────────────────────────────────────────────────────

const DateQuerySchema = z.object({
  date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  level: z.string().optional(),
});

const DailyTaskPostSchema = z.object({
  date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  level: z.union([LiteracyLevelSchema, z.literal("all")]),
  skills: z
    .array(SkillSchema)
    .min(1, "Select at least one skill.")
    .max(4),
  contentBySkill: z.record(
    SkillSchema,
    z.array(IdSchema).max(20)
  ).optional(),
  rpValue: z.number().int().min(5).max(20),
});

// ── Auth helper ───────────────────────────────────────────────────────────

async function requireAdmin(): Promise<string | null> {
  const store = await cookies();
  const token = store.get("admin_token")?.value;
  if (!token) return null;
  try {
    const payload = verifyAdminJwt(token);
    return payload.adminId;
  } catch {
    return null;
  }
}

function parseDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const adminId = await requireAdmin();
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
        isAssessmentDefault: false,
        deletedAt: null,
        ...(levelFilter
          ? { OR: [{ level: levelFilter }, { level: null }] }
          : { level: null }),
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
        ...(levelFilter ? { level: levelFilter } : { level: null }),
      },
      select: {
        id: true,
        taskDate: true,
        skill: true,
        level: true,
        rpValue: true,
        contentLinks: {
          select: {
            contentItemId: true,
            contentItem: { select: { id: true, title: true, skill: true } },
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
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(
      DailyTaskPostSchema,
      await req.json().catch(() => null),
      "admin/daily-tasks POST"
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const taskDate   = parseDateOnly(body.date);
    const levelValue = body.level !== "all" ? body.level : null;
    const skills     = Array.from(new Set(body.skills));

    // ── Skill/content mismatch validation (server-side guard) ─────────────
    // Mirrors the P0-2 fix — content items must match their assigned skill.
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
            return NextResponse.json(
              { error: `Content item ${id} not found or archived.` },
              { status: 400 }
            );
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

    // ── Create / update tasks in transaction ──────────────────────────────
    const created = await prisma.$transaction(async (tx) => {
      const results: { skill: string; taskId: string }[] = [];

      for (const skill of skills) {
        const existing = await tx.dailyTask.findFirst({
          where: { taskDate, skill, level: levelValue },
          select: { id: true },
        });

        const task =
          existing ??
          (await tx.dailyTask.create({
            data: {
              taskDate,
              skill,
              level: levelValue,
              rpValue: body.rpValue,
              createdByAdminId: adminId,
            },
            select: { id: true },
          }));

        if (existing) {
          await tx.dailyTask.update({
            where: { id: existing.id },
            data: { rpValue: body.rpValue },
          });
        }

        const contentIds = (body.contentBySkill?.[skill] ?? []).filter(Boolean);
        await tx.dailyTaskContent.deleteMany({ where: { dailyTaskId: task.id } });

        if (contentIds.length > 0) {
          await tx.dailyTaskContent.createMany({
            data: contentIds.map((contentItemId) => ({ dailyTaskId: task.id, contentItemId })),
            skipDuplicates: true,
          });
        }

        const eligibleChildren = await tx.child.findMany({
          where: {
            status: "active",
            ...(levelValue ? { level: levelValue } : {}),
          },
          select: { id: true },
        });

        if (eligibleChildren.length > 0) {
          await tx.dailySubmission.createMany({
            data: eligibleChildren.map((c) => ({
              childId: c.id,
              dailyTaskId: task.id,
            })),
            skipDuplicates: true,
          });
        }

        results.push({ skill, taskId: task.id });
      }

      return results;
    });

    return NextResponse.json({ ok: true, created });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}