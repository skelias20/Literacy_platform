// app/api/admin/page-videos/[pageKey]/route.ts
// GET  /api/admin/page-videos/[pageKey] — return current videoUrl for a page
// PUT  /api/admin/page-videos/[pageKey] — upsert or remove videoUrl (admin only)
//
// pageKey must be one of: dashboard | assessment | task | registration
// PUT body: { videoUrl: string | null }  — null or empty string removes the row (no video shown)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { z } from "zod";

export const runtime = "nodejs";

const PageKeySchema = z.enum(["dashboard", "assessment", "task", "registration"]);

const UpdateSchema = z.object({
  videoUrl: z.string().nullable(),
});

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try { return verifyAdminJwt(token).adminId; }
  catch { return null; }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pageKey: string }> },
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { pageKey } = await params;
    const parsed = PageKeySchema.safeParse(pageKey);
    if (!parsed.success) return NextResponse.json({ error: "Invalid page key" }, { status: 400 });

    const row = await prisma.pageGuidanceVideo.findUnique({
      where: { pageKey: parsed.data },
      select: { videoUrl: true, updatedAt: true },
    });

    return NextResponse.json({ videoUrl: row?.videoUrl ?? null, updatedAt: row?.updatedAt ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ pageKey: string }> },
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { pageKey } = await params;
    const keyParsed = PageKeySchema.safeParse(pageKey);
    if (!keyParsed.success) return NextResponse.json({ error: "Invalid page key" }, { status: 400 });

    const parsed = parseBody(UpdateSchema, await req.json().catch(() => null), "page-videos");
    if (!parsed.ok) return parsed.response;
    const { videoUrl } = parsed.data;

    const trimmed = videoUrl?.trim() ?? "";

    // Empty or null videoUrl → remove the row so no video is shown
    if (!trimmed) {
      await prisma.pageGuidanceVideo.deleteMany({ where: { pageKey: keyParsed.data } });
      return NextResponse.json({ ok: true, videoUrl: null });
    }

    await prisma.pageGuidanceVideo.upsert({
      where:  { pageKey: keyParsed.data },
      create: { pageKey: keyParsed.data, videoUrl: trimmed, updatedByAdminId: adminId },
      update: { videoUrl: trimmed, updatedByAdminId: adminId },
    });

    return NextResponse.json({ ok: true, videoUrl: trimmed });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
