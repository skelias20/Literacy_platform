// app/api/admin/daily-tasks/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

type AdminJwtPayload = { adminId: string; email: string };

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const SECRET = mustGetEnv("JWT_SECRET");

async function requireAdmin(): Promise<AdminJwtPayload | null> {
  const store = await cookies();
  const token = store.get("admin_token")?.value;
  if (!token) return null;

  const decoded = jwt.verify(token, SECRET);
  if (typeof decoded !== "object" || decoded === null) return null;

  const p = decoded as jwt.JwtPayload;
  const adminId = p.adminId;
  const email = p.email;

  if (typeof adminId !== "string" || typeof email !== "string") return null;
  return { adminId, email };
}

type SkillType = "reading" | "listening" | "writing" | "speaking";
type LiteracyLevel = "foundational" | "functional" | "transitional" | "advanced";

function parseDateOnly(dateStr: string): Date | null {
  // Expect "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  // store as UTC midnight; consistent compare by using same format in queries
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date"); // "YYYY-MM-DD"
    const level = searchParams.get("level"); // "all" | LiteracyLevel

    if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });
    const taskDate = parseDateOnly(date);
    if (!taskDate) return NextResponse.json({ error: "Invalid date format" }, { status: 400 });

    const levelFilter: LiteracyLevel | null =
      level && level !== "all" ? (level as LiteracyLevel) : null;

    // Content: filter by level when provided, otherwise show any.
    // Keep it simple: only show content items that are NOT assessment defaults.
    const content = await prisma.contentItem.findMany({
      where: {
        isAssessmentDefault: false,
        ...(levelFilter ? { level: levelFilter } : {}),
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

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as {
      date: string; // "YYYY-MM-DD"
      level: "all" | LiteracyLevel;
      skills: SkillType[];
      // map of skill -> content ids
      contentBySkill: Partial<Record<SkillType, string[]>>;
    };

    const taskDate = parseDateOnly(body.date);
    if (!taskDate) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

    const levelValue: LiteracyLevel | null =
      body.level !== "all" ? body.level : null;

    const skills = Array.from(new Set(body.skills ?? []));
    if (skills.length === 0) {
      return NextResponse.json({ error: "Select at least one skill" }, { status: 400 });
    }

    // Create each task in a transaction
    const created = await prisma.$transaction(async (tx) => {
      const results: { skill: SkillType; taskId: string }[] = [];

      for (const skill of skills) {
        // prevent duplicates: one task per (date, skill, levelValue)
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
              createdByAdminId: admin.adminId,
            },
            select: { id: true },
          }));

        // Replace content links for this task
        const contentIds = (body.contentBySkill?.[skill] ?? []).filter(Boolean);

        // wipe old links then create new
        await tx.dailyTaskContent.deleteMany({ where: { dailyTaskId: task.id } });

        if (contentIds.length > 0) {
          await tx.dailyTaskContent.createMany({
            data: contentIds.map((contentItemId) => ({
              dailyTaskId: task.id,
              contentItemId,
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
