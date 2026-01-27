import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { child: true },
  });

  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (payment.status !== "pending") {
    return NextResponse.json(
      { error: "Payment is not pending" },
      { status: 400 }
    );
  }

  // NOTE: adminId from JWT will be added later. For now we store null.
  const updated = await prisma.payment.update({
    where: { id },
    data: {
      status: "approved",
      reviewedAt: new Date(),
      // reviewedByAdminId: adminId (we’ll wire this next step)
      child: {
        update: {
          status: "approved_pending_login",
        },
      },
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: (await prisma.admin.findFirst({ select: { id: true } }))!.id,
      action: "PAYMENT_APPROVED",
      targetPaymentId: id,
      targetChildId: payment.childId,
      metadata: { method: payment.method },
    },
  });

  return NextResponse.json({ ok: true, payment: updated });
}
