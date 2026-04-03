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
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { child: true },
  });

  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (payment.status !== "pending") {
    return NextResponse.json({ error: "Payment is not pending" }, { status: 400 });
  }

  // Read BillingConfig outside the transaction — it's a read-only config lookup.
  // Falls back to 30 days if no config row exists yet.
  const billingConfig = await prisma.billingConfig.findFirst();
  const cycleDays = billingConfig?.cycleDays ?? 30;

  const now = new Date();
  const periodEnd = new Date(now.getTime() + cycleDays * 86_400_000);

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id },
      data: {
        status: "approved",
        reviewedAt: now,
        reviewedByAdminId: adminId,
      },
    });

    await tx.child.update({
      where: { id: payment.childId },
      data: {
        status: "approved_pending_login",
        // First subscription period starts at approval time.
        subscriptionExpiresAt: periodEnd,
      },
    });

    // Create the first Subscription row for this child.
    await tx.subscription.create({
      data: {
        childId: payment.childId,
        periodStart: now,
        periodEnd,
        // renewalPaymentId is null for the registration-derived first period.
      },
    });

    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: "PAYMENT_APPROVED",
        targetPaymentId: id,
        targetChildId: payment.childId,
        metadata: { method: payment.method },
      },
    });

    await tx.paymentEvent.create({
      data: {
        childId: payment.childId,
        paymentId: id,
        eventType: "PAYMENT_APPROVED",
        statusBefore: payment.child.status,
        statusAfter: "approved_pending_login",
        method: payment.method,
        reference: payment.transactionId ?? null,
        adminId,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
