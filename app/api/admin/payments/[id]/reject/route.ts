import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim();

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

  const updated = await prisma.payment.update({
    where: { id },
    data: {
      status: "rejected",
      reviewNote: reason || null,
      reviewedAt: new Date(),
      child: {
        update: {
          status: "rejected",
        },
      },
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: (await prisma.admin.findFirst({ select: { id: true } }))!.id,
      action: "PAYMENT_REJECTED",
      targetPaymentId: id,
      targetChildId: payment.childId,
      metadata: { reason: reason || null, method: payment.method },
    },
  });

  return NextResponse.json({ ok: true, payment: updated });
}
