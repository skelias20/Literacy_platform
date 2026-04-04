// app/api/admin/files/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/serverAuth";
import { generatePresignedGetUrl } from "@/lib/r2";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const adminId = await requireAdminAuth();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const file = await prisma.file.findUnique({
    where: { id },
    select: {
      id: true,
      storageKey: true,
      r2Key: true,
      mimeType: true,
      originalName: true,
      uploadStatus: true,
    },
  });

  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // R2-hosted file: generate short-lived presigned GET URL (5 min for admin downloads)
  if (file.r2Key) {
    const signedUrl = await generatePresignedGetUrl(file.r2Key, 300);
    return NextResponse.redirect(signedUrl, { status: 302 });
  }

  // Legacy: local filesystem (pre-R2 files)
  try {
    const absPath = path.join(process.cwd(), file.storageKey);
    const buf = await fs.readFile(absPath);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.originalName}"`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "File not found on disk. It may have been migrated to cloud storage." },
      { status: 404 }
    );
  }
}