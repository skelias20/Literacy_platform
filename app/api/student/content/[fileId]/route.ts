// app/api/student/content/[fileId]/route.ts
// Serves content library files (PDFs, audio) to authenticated students.
// Generates a short-lived presigned GET URL — bucket stays private.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyStudentJwt } from "@/lib/auth";
import { generatePresignedGetUrl } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ fileId: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("student_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyStudentJwt(token);

    // Verify student is active
    const child = await prisma.child.findUnique({
      where: { id: payload.childId },
      select: { status: true },
    });
    if (!child || child.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { fileId } = await ctx.params;

    // Verify this file is actually used as content (not a student artifact)
    const contentItem = await prisma.contentItem.findFirst({
      where: { fileId, deletedAt: null },
      select: { id: true },
    });
    if (!contentItem) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const file = await prisma.file.findUnique({
      where: { id: fileId },
      select: { r2Key: true, mimeType: true, originalName: true },
    });
    if (!file?.r2Key) {
      return NextResponse.json({ error: "File not available" }, { status: 404 });
    }

    // 5-minute presigned GET URL — enough to load a PDF or audio file
    const signedUrl = await generatePresignedGetUrl(file.r2Key, 300);
    return NextResponse.redirect(signedUrl, { status: 302 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}