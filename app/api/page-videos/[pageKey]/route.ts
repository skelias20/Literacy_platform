// app/api/page-videos/[pageKey]/route.ts
// Public — no auth required.
// Returns { videoUrl: string | null } for the given page key.
// Used by client components (assessment, task, registration) that may not have a student token.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const PageKeySchema = z.enum(["dashboard", "assessment", "task", "registration"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pageKey: string }> },
) {
  try {
    const { pageKey } = await params;
    const parsed = PageKeySchema.safeParse(pageKey);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid page key" }, { status: 400 });
    }

    const row = await prisma.pageGuidanceVideo.findUnique({
      where: { pageKey: parsed.data },
      select: { videoUrl: true },
    });

    return NextResponse.json({ videoUrl: row?.videoUrl ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
