// app/api/student/subscription/renew/route.ts
// POST /api/student/subscription/renew
// Student submits a renewal payment (method + receipt or transaction ID).
// Creates a RenewalPayment row and writes a RENEWAL_SUBMITTED PaymentEvent.
// Blocked if:
//   - student status is pending_payment or rejected
//   - a pending RenewalPayment already exists for this child

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";
import { z } from "zod";
import { requireStudentAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

const RenewSchema = z.object({
  method: z.enum(["receipt_upload", "transaction_id"] as const, {
    error: "Invalid payment method.",
  }),
  receiptFileId: z.string().max(128).trim().optional(),
  transactionId: z.string().max(128).trim().optional(),
}).superRefine((data, ctx) => {
  if (data.method === "transaction_id" && !data.transactionId) {
    ctx.addIssue({ code: "custom", message: "Transaction ID is required.", path: ["transactionId"] });
  }
  if (data.method === "receipt_upload" && !data.receiptFileId) {
    ctx.addIssue({ code: "custom", message: "Receipt upload is required.", path: ["receiptFileId"] });
  }
});

export async function POST(req: Request) {
  try {
    const student = await requireStudentAuth(req);
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const childId = student.childId;

    const parsed = parseBody(RenewSchema, await req.json().catch(() => null), "subscription/renew");
    if (!parsed.ok) return parsed.response;
    const { method, receiptFileId, transactionId } = parsed.data;

    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, status: true },
    });
    if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Students that haven't been approved or were rejected cannot submit renewals.
    if (child.status === "pending_payment" || child.status === "rejected") {
      return NextResponse.json({ error: "Renewal not available for your account status." }, { status: 403 });
    }

    // Only one pending renewal at a time.
    const existingPending = await prisma.renewalPayment.findFirst({
      where: { childId, status: "pending" },
      select: { id: true },
    });
    if (existingPending) {
      return NextResponse.json(
        { error: "You already have a pending renewal awaiting review." },
        { status: 409 }
      );
    }

    // Verify the uploaded receipt file exists, is COMPLETED, and belongs to this student.
    if (method === "receipt_upload" && receiptFileId) {
      const file = await prisma.file.findUnique({
        where: { id: receiptFileId },
        select: { id: true, uploadStatus: true, uploadedByChildId: true },
      });
      if (!file) {
        return NextResponse.json({ error: "Receipt file not found." }, { status: 400 });
      }
      if (file.uploadedByChildId !== childId) {
        return NextResponse.json({ error: "Receipt file not found." }, { status: 400 });
      }
      if (file.uploadStatus !== "COMPLETED") {
        return NextResponse.json(
          { error: "Receipt upload is still processing. Please wait and try again." },
          { status: 400 }
        );
      }
    }

    const renewal = await prisma.$transaction(async (tx) => {
      const created = await tx.renewalPayment.create({
        data: {
          childId,
          method,
          status: "pending",
          transactionId: method === "transaction_id" ? (transactionId ?? null) : null,
          receiptFileId: method === "receipt_upload"  ? (receiptFileId ?? null) : null,
        },
      });

      await tx.paymentEvent.create({
        data: {
          childId,
          renewalPaymentId: created.id,
          eventType: "RENEWAL_SUBMITTED",
          method,
          reference: method === "transaction_id" ? (transactionId ?? null) : null,
        },
      });

      return created;
    });

    return NextResponse.json({ ok: true, renewalPaymentId: renewal.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
