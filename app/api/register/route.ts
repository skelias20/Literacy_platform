// app/api/register/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rateLimit";

export const runtime = "nodejs";

function normEmail(email: string) {
  return email.trim().toLowerCase();
}

function clean(v: FormDataEntryValue | null) {
  return String(v ?? "").trim();
}

export async function POST(req: Request) {
  try {
    // ── Rate limit ─────────────────────────────────────────────────────────
    const ip = getClientIp(req);
    const rl = rateLimit(`register:${ip}`, RATE_LIMITS.registration);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429 }
      );
    }

    const form = await req.formData();

    const childFirstName = clean(form.get("childFirstName"));
    const childLastName = clean(form.get("childLastName"));
    const grade = Number(form.get("grade"));
    const dateOfBirthRaw = clean(form.get("dateOfBirth"));

    const parentFirstName = clean(form.get("parentFirstName"));
    const parentLastName = clean(form.get("parentLastName"));
    const parentEmail = normEmail(clean(form.get("parentEmail")));
    const parentPhone = clean(form.get("parentPhone"));

    const paymentMethod = clean(form.get("paymentMethod"));
    const transactionIdRaw = clean(form.get("transactionId"));

    // For receipt uploads, the frontend now sends the fileId from presign/confirm
    const receiptFileId = clean(form.get("receiptFileId")) || null;

    // ── Validation ─────────────────────────────────────────────────────────
    if (!childFirstName || !childLastName) {
      return NextResponse.json({ error: "Child name is required." }, { status: 400 });
    }
    if (!Number.isInteger(grade) || grade < 1 || grade > 8) {
      return NextResponse.json({ error: "Grade must be between 1 and 8." }, { status: 400 });
    }
    if (!dateOfBirthRaw) {
      return NextResponse.json({ error: "Date of birth is required." }, { status: 400 });
    }
    const dateOfBirth = new Date(dateOfBirthRaw);
    if (isNaN(dateOfBirth.getTime())) {
      return NextResponse.json({ error: "Date of birth is invalid." }, { status: 400 });
    }
    const now = new Date();
    if (dateOfBirth >= now) {
      return NextResponse.json({ error: "Date of birth must be in the past." }, { status: 400 });
    }
    if (now.getFullYear() - dateOfBirth.getFullYear() > 25) {
      return NextResponse.json({ error: "Date of birth seems too far in the past." }, { status: 400 });
    }
    if (!parentFirstName || !parentLastName || !parentEmail || !parentPhone) {
      return NextResponse.json({ error: "Parent info is required." }, { status: 400 });
    }
    if (paymentMethod !== "transaction_id" && paymentMethod !== "receipt_upload") {
      return NextResponse.json({ error: "Invalid payment method." }, { status: 400 });
    }
    if (paymentMethod === "transaction_id" && !transactionIdRaw) {
      return NextResponse.json({ error: "Transaction ID is required." }, { status: 400 });
    }
    if (paymentMethod === "receipt_upload") {
      if (!receiptFileId) {
        return NextResponse.json(
          { error: "Receipt upload is required. Please upload your receipt first." },
          { status: 400 }
        );
      }
      // Verify the file record exists and is COMPLETED
      const fileRecord = await prisma.file.findUnique({
        where: { id: receiptFileId },
        select: { id: true, uploadStatus: true, mimeType: true },
      });
      if (!fileRecord) {
        return NextResponse.json({ error: "Receipt file not found." }, { status: 400 });
      }
      if (fileRecord.uploadStatus !== "COMPLETED") {
        return NextResponse.json(
          { error: "Receipt upload is still processing. Please wait a moment and try again." },
          { status: 400 }
        );
      }
    }

    // ── Upsert parent ──────────────────────────────────────────────────────
    const parent = await prisma.parent.upsert({
      where: { parents_email_phone_unique: { email: parentEmail, phone: parentPhone } },
      update: { firstName: parentFirstName, lastName: parentLastName },
      create: {
        firstName: parentFirstName,
        lastName: parentLastName,
        email: parentEmail,
        phone: parentPhone,
      },
    });

    // ── Create child + payment in transaction ──────────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      const child = await tx.child.create({
        data: {
          parentId: parent.id,
          childFirstName,
          childLastName,
          grade,
          dateOfBirth,
          status: "pending_payment",
        },
      });

      // Link the uploaded file to this child
      if (receiptFileId) {
        await tx.file.update({
          where: { id: receiptFileId },
          data: { uploadedByChildId: child.id },
        });
      }

      const payment = await tx.payment.create({
        data: {
          childId: child.id,
          method: paymentMethod,
          status: "pending",
          transactionId: paymentMethod === "transaction_id" ? transactionIdRaw : null,
          receiptFileId: paymentMethod === "receipt_upload" ? receiptFileId : null,
        },
      });

      return { child, payment };
    });

    return NextResponse.json({
      ok: true,
      childId: result.child.id,
      paymentId: result.payment.id,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}