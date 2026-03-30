import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      verifyAdminJwt(token);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Query ─────────────────────────────────────────────────────────────
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status") ?? "pending";

    if (statusParam !== "pending" && statusParam !== "approved" && statusParam !== "rejected") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const payments = await prisma.payment.findMany({
      where: { status: statusParam },
      orderBy: { createdAt: "desc" },
      include: {
        child: {
          include: {
            parent: true,
          },
        },
        receiptFile: {
          select: {
            id: true,
            storageKey: true,
            originalName: true,
            mimeType: true,
            createdAt: true,
            // IMPORTANT: do NOT select byteSize (BigInt) or sha256 unless you need it
          },
        },
      },
    });
    

    return NextResponse.json({ payments });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
