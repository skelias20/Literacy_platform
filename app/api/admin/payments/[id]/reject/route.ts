import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";
import { z } from "zod";
import { requireAdminAuth } from "@/lib/serverAuth";
import { sendPaymentRejectedEmail } from "@/lib/email";

export const runtime = "nodejs";

const RejectSchema = z.object({
  reason: z.string().max(500).optional().default(""),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await requireAdminAuth(req);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;

    const parsed = parseBody(RejectSchema, await req.json().catch(() => ({})), "payments/reject");
    if (!parsed.ok) return parsed.response;
    const { reason } = parsed.data;

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: {
        id: true, status: true, childId: true, method: true, transactionId: true,
        child: {
          select: {
            childFirstName: true, childLastName: true, archivedAt: true,
            parent: { select: { email: true } },
          },
        },
      },
    });

    if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (payment.status !== "pending") {
      return NextResponse.json({ error: "Payment is not pending" }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: {
          status: "rejected",
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
        },
      });

      await tx.child.update({
        where: { id: payment.childId },
        data: { status: "rejected" },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "PAYMENT_REJECTED",
          targetPaymentId: id,
          targetChildId: payment.childId,
          metadata: { reason: reason || null, method: payment.method },
        },
      });

      await tx.paymentEvent.create({
        data: {
          childId: payment.childId,
          paymentId: id,
          eventType: "PAYMENT_REJECTED",
          statusBefore: "pending_payment",
          statusAfter: "rejected",
          method: payment.method,
          reference: payment.transactionId ?? null,
          notes: reason || null,
          adminId,
        },
      });
    });

    void sendPaymentRejectedEmail(
      payment.child.parent?.email,
      `${payment.child.childFirstName} ${payment.child.childLastName}`,
      reason || null
    ).catch(console.error);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
