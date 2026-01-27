import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

export const runtime = "nodejs"; // needed for fs on Next.js

function normEmail(email: string) {
  return email.trim().toLowerCase();
}

function clean(v: FormDataEntryValue | null) {
  return String(v ?? "").trim();
}

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

function extFromImageMime(mime: string) {
  // strict-ish mapping, defaults to png
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const childFirstName = clean(form.get("childFirstName"));
    const childLastName = clean(form.get("childLastName"));
    const grade = Number(form.get("grade"));

    const parentFirstName = clean(form.get("parentFirstName"));
    const parentLastName = clean(form.get("parentLastName"));
    const parentEmail = normEmail(clean(form.get("parentEmail")));
    const parentPhone = clean(form.get("parentPhone"));

    const paymentMethod = clean(form.get("paymentMethod"));
    const transactionIdRaw = clean(form.get("transactionId"));
    const receipt = form.get("receipt"); // may be File

    // Minimal validation
    if (!childFirstName || !childLastName) {
      return NextResponse.json({ error: "Child name is required." }, { status: 400 });
    }
    if (!Number.isInteger(grade) || grade < 1 || grade > 8) {
      return NextResponse.json({ error: "Grade must be between 1 and 8." }, { status: 400 });
    }
    if (!parentFirstName || !parentLastName || !parentEmail || !parentPhone) {
      return NextResponse.json({ error: "Parent info is required." }, { status: 400 });
    }
    if (paymentMethod !== "transaction_id" && paymentMethod !== "receipt_upload") {
      return NextResponse.json({ error: "Invalid payment method." }, { status: 400 });
    }

    if (paymentMethod === "transaction_id") {
      if (!transactionIdRaw) {
        return NextResponse.json({ error: "Transaction ID is required." }, { status: 400 });
      }
    } else {
      // receipt_upload
      if (!(receipt instanceof File)) {
        return NextResponse.json({ error: "Receipt image is required." }, { status: 400 });
      }
      if (!isImageMime(receipt.type)) {
        return NextResponse.json(
          { error: "Receipt must be an image (jpg/png/webp/gif). PDFs are not allowed." },
          { status: 400 }
        );
      }
      if (receipt.size <= 0) {
        return NextResponse.json({ error: "Receipt image is empty." }, { status: 400 });
      }
      // Optional: size limit for demo safety (e.g., 5MB)
      const maxBytes = 5 * 1024 * 1024;
      if (receipt.size > maxBytes) {
        return NextResponse.json({ error: "Receipt image must be <= 5MB." }, { status: 400 });
      }
    }

    // Upsert parent by (email + phone)
    const parent = await prisma.parent.upsert({
      where: {
        parents_email_phone_unique: { email: parentEmail, phone: parentPhone },
      },
      update: { firstName: parentFirstName, lastName: parentLastName },
      create: { firstName: parentFirstName, lastName: parentLastName, email: parentEmail, phone: parentPhone },
    });

    // Create child + payment (and file if receipt) in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const child = await tx.child.create({
        data: {
          parentId: parent.id,
          childFirstName,
          childLastName,
          grade,
          status: "pending_payment",
        },
      });

      let receiptFileId: string | null = null;

      if (paymentMethod === "receipt_upload") {
        const file = receipt as File;

        const bytes = Buffer.from(await file.arrayBuffer());
        const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
        const ext = extFromImageMime(file.type);

        const filename = `receipt_${child.id}_${Date.now()}_${sha256.slice(0, 10)}.${ext}`;
        const relPath = path.join("uploads", filename);
        const absPath = path.join(process.cwd(), relPath);

        // ensure uploads dir exists
        await fs.mkdir(path.join(process.cwd(), "uploads"), { recursive: true });
        await fs.writeFile(absPath, bytes);

        const saved = await tx.file.create({
          data: {
            storageKey: relPath,
            originalName: file.name || filename,
            mimeType: file.type,
            byteSize: BigInt(bytes.length),
            sha256,
            uploadedByChildId: child.id,
          },
        });

        receiptFileId = saved.id;
      }

      const payment = await tx.payment.create({
        data: {
          childId: child.id,
          method: paymentMethod,
          status: "pending",
          transactionId: paymentMethod === "transaction_id" ? transactionIdRaw : null,
          receiptFileId,
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
