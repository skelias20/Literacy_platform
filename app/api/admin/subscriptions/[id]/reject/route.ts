// app/api/admin/subscriptions/[id]/reject/route.ts
// POST /api/admin/subscriptions/[id]/reject
// Rejects a pending RenewalPayment. Does NOT touch any Subscription rows or
// Child.subscriptionExpiresAt — rejection leaves billing state unchanged.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { z } from "zod";

export const runtime = "nodejs";

const RejectSchema = z.object({
  reason: z.string().max(500).optional().default(""),
});

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try { return verifyAdminJwt(token).adminId; }
  catch { return null; }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;

    const parsed = parseBody(RejectSchema, await req.json().catch(() => ({})), "subscriptions/reject");
    if (!parsed.ok) return parsed.response;
    const { reason } = parsed.data;

    const renewal = await prisma.renewalPayment.findUnique({
      where: { id },
      select: { id: true, childId: true, status: true, method: true, transactionId: true },
    });

    if (!renewal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (renewal.status !== "pending") {
      return NextResponse.json({ error: "Renewal is not pending" }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.renewalPayment.update({
        where: { id },
        data: {
          status: "rejected",
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "RENEWAL_REJECTED",
          targetChildId: renewal.childId,
          metadata: { renewalPaymentId: id, reason: reason || null },
        },
      });

      await tx.paymentEvent.create({
        data: {
          childId: renewal.childId,
          renewalPaymentId: id,
          eventType: "RENEWAL_REJECTED",
          method: renewal.method,
          reference: renewal.transactionId ?? null,
          notes: reason || null,
          adminId,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
