// app/api/admin/subscriptions/route.ts
// GET /api/admin/subscriptions?status=pending|approved|rejected
// Returns RenewalPayment rows with child + receipt file info.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/serverAuth";
import type { RenewalPaymentStatus } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const adminId = await requireAdminAuth();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const statusParam = (searchParams.get("status") ?? "pending") as RenewalPaymentStatus;

    if (!["pending", "approved", "rejected"].includes(statusParam)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const renewals = await prisma.renewalPayment.findMany({
      where: { status: statusParam },
      orderBy: { createdAt: "desc" },
      include: {
        child: {
          select: {
            id: true,
            childFirstName: true,
            childLastName: true,
            grade: true,
            status: true,
            subscriptionExpiresAt: true,
            parent: {
              select: { firstName: true, lastName: true, email: true, phone: true },
            },
          },
        },
        receiptFile: {
          select: { id: true, originalName: true, mimeType: true },
        },
        reviewedByAdmin: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    return NextResponse.json({ renewals });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
