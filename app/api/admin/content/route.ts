// app/api/admin/content/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { deleteR2Object } from "@/lib/r2";
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rateLimit";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
const SECRET = mustGetEnv("JWT_SECRET");

async function requireAdmin(req: Request): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try {
    const p = jwt.verify(token, SECRET) as jwt.JwtPayload;
    return typeof p.adminId === "string" ? p.adminId : null;
  } catch { return null; }
}

// ── GET /api/admin/content — list content library ─────────────────────────
export async function GET(req: Request) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const skill = searchParams.get("skill");
  const level = searchParams.get("level");
  const includeDeleted = searchParams.get("includeDeleted") === "true";

  const rawItems = await prisma.contentItem.findMany({
    where: {
      ...(skill ? { skill: skill as never } : {}),
      ...(level && level !== "all" ? { level: level as never } : {}),
      ...(includeDeleted ? {} : { deletedAt: null }),
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
      isAssessmentDefault: true,
      deletedAt: true,
      createdAt: true,
      file: {
        select: {
          id: true,
          storageUrl: true,
          originalName: true,
          mimeType: true,
          byteSize: true,   // BigInt — must be converted before JSON serialization
          uploadStatus: true,
        },
      },
    },
    orderBy: [{ skill: "asc" }, { createdAt: "desc" }],
  });

  // BigInt cannot be serialized by JSON.stringify — convert byteSize to string.
  // Using string (not number) to avoid precision loss on very large files.
  const items = rawItems.map((item) => ({
    ...item,
    file: item.file
      ? { ...item.file, byteSize: item.file.byteSize.toString() }
      : null,
  }));

  return NextResponse.json({ items });
}

// ── POST /api/admin/content — create content item after upload ────────────
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit(`admin_content:${ip}`, RATE_LIMITS.adminUpload);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { title, description, skill, level, type, textBody, fileId, mimeType } = body as {
      title: string;
      description?: string;
      skill: string;
      level?: string;
      type: string;
      textBody?: string;
      fileId?: string;
      mimeType?: string;
    };

    if (!title?.trim()) return NextResponse.json({ error: "Title required" }, { status: 400 });
    if (!skill) return NextResponse.json({ error: "Skill required" }, { status: 400 });
    if (!type) return NextResponse.json({ error: "Type required" }, { status: 400 });

    // If a fileId is provided, verify it's COMPLETED
    if (fileId) {
      const file = await prisma.file.findUnique({
        where: { id: fileId },
        select: { id: true, uploadStatus: true, storageUrl: true },
      });
      if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
      if (file.uploadStatus !== "COMPLETED") {
        return NextResponse.json(
          { error: "File upload is still processing. Please wait and try again." },
          { status: 400 }
        );
      }
    }

    // assetUrl points to the student-facing secure content route.
    // Admin uses /api/admin/files/[fileId] directly for preview.
    // Students use /api/student/content/[fileId] which verifies active status.
    // Both routes generate presigned GET URLs — bucket stays fully private.
    const assetUrl = fileId ? `/api/student/content/${fileId}` : null;

    const item = await prisma.contentItem.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        skill: skill as never,
        level: level && level !== "all" ? (level as never) : null,
        type: type as never,
        textBody: textBody?.trim() || null,
        fileId: fileId || null,
        assetUrl,
        mimeType: mimeType || null,
        createdByAdminId: adminId,
      },
    });

    return NextResponse.json({ ok: true, item });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PATCH /api/admin/content — rename or update metadata ──────────────────
export async function PATCH(req: Request) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { id, title, description, level } = body as {
      id: string;
      title?: string;
      description?: string;
      level?: string;
    };

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const item = await prisma.contentItem.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (item.deletedAt) {
      return NextResponse.json({ error: "Cannot edit a deleted item" }, { status: 400 });
    }

    const updated = await prisma.contentItem.update({
      where: { id },
      data: {
        ...(title?.trim() ? { title: title.trim() } : {}),
        ...(description !== undefined ? { description: description.trim() || null } : {}),
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

// ── DELETE /api/admin/content — soft delete with active-link warning ───────
export async function DELETE(req: Request) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { id, force } = body as { id: string; force?: boolean };

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

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
            dailyTask: {
              select: { id: true, taskDate: true, skill: true },
            },
          },
        },
      },
    });

    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (item.deletedAt) {
      return NextResponse.json({ error: "Already deleted" }, { status: 400 });
    }

    // Check for active future task links
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureTasks = item.dailyTaskLinks.filter(
      (l) => new Date(l.dailyTask.taskDate) >= today
    );

    if (futureTasks.length > 0 && !force) {
      // Return warning — let admin decide
      return NextResponse.json(
        {
          warning: true,
          message: `This content is linked to ${futureTasks.length} upcoming task(s). Deleting it will not remove it from those tasks but students will see it as unavailable. Pass force: true to confirm.`,
          affectedTasks: futureTasks.map((l) => ({
            taskId: l.dailyTask.id,
            taskDate: l.dailyTask.taskDate,
            skill: l.dailyTask.skill,
          })),
        },
        { status: 200 }
      );
    }

    // Soft delete — never hard delete, file may be referenced in submissions
    await prisma.contentItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}