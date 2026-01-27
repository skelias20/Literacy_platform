import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const SECRET = mustGetEnv("JWT_SECRET");

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await ctx.params;

    if (!fileId) {
      return NextResponse.json({ error: "Missing fileId param" }, { status: 400 });
    }

    // ---- admin auth ----
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = jwt.verify(token, SECRET);
    if (typeof decoded !== "object" || decoded === null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ---- ensure this fileId is actually a payment receipt ----
    const usedAsReceipt = await prisma.payment.findFirst({
      where: { receiptFileId: fileId },
      select: { id: true },
    });

    if (!usedAsReceipt) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---- load file record ----
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      select: { storageKey: true, mimeType: true, originalName: true },
    });

    if (!file) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const absPath = path.join(process.cwd(), file.storageKey);
    const bytes = await fs.readFile(absPath);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${file.originalName ?? "receipt"}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "JsonWebTokenError") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
