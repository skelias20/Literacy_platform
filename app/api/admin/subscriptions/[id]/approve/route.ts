// app/api/admin/subscriptions/[id]/approve/route.ts
// POST /api/admin/subscriptions/[id]/approve
// Approves a pending RenewalPayment → creates the next Subscription row →
// updates Child.subscriptionExpiresAt → writes PaymentEvent + AdminAuditLog.
// All writes are in a single transaction.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";

export const runtime = "nodejs";

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try { return verifyAdminJwt(token).adminId; }
  catch { return null; }
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;

    const renewal = await prisma.renewalPayment.findUnique({
      where: { id },
      select: {
        id: true,
        childId: true,
        status: true,
        method: true,
        transactionId: true,
        child: {
          select: { subscriptionExpiresAt: true },
        },
      },
    });

    if (!renewal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (renewal.status !== "pending") {
      return NextResponse.json({ error: "Renewal is not pending" }, { status: 400 });
    }

    // Read config outside the transaction — read-only, single-row.
    const billingConfig = await prisma.billingConfig.findFirst();
    const cycleDays = billingConfig?.cycleDays ?? 30;

    const now = new Date();

    // New period starts from the child's current subscriptionExpiresAt (so no gap, no lost days).
    // Edge case: if subscriptionExpiresAt is null (no prior period) use now as periodStart.
    const periodStart = renewal.child.subscriptionExpiresAt ?? now;
    const periodEnd = new Date(periodStart.getTime() + cycleDays * 86_400_000);

    await prisma.$transaction(async (tx) => {
      await tx.renewalPayment.update({
        where: { id },
        data: {
          status: "approved",
          reviewedByAdminId: adminId,
          reviewedAt: now,
        },
      });

      await tx.subscription.create({
        data: {
          childId: renewal.childId,
          periodStart,
          periodEnd,
          renewalPaymentId: id,
        },
      });

      await tx.child.update({
        where: { id: renewal.childId },
        data: { subscriptionExpiresAt: periodEnd },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "RENEWAL_APPROVED",
          targetChildId: renewal.childId,
          metadata: {
            renewalPaymentId: id,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
          },
        },
      });

      await tx.paymentEvent.create({
        data: {
          childId: renewal.childId,
          renewalPaymentId: id,
          eventType: "RENEWAL_APPROVED",
          method: renewal.method,
          reference: renewal.transactionId ?? null,
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
