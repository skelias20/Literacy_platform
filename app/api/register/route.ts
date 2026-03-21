// app/api/register/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rateLimit";
import { parseBody } from "@/lib/parseBody";

export const runtime = "nodejs";

// ── Registration schema ───────────────────────────────────────────────────
// FormData fields are all strings — Zod coerces/validates each one.
// Date of birth uses z.coerce.date() which converts "YYYY-MM-DD" strings.
const RegistrationSchema = z.object({
  // Child fields
  childFirstName: z.string().min(1, "Child first name is required.").max(64).trim(),
  childLastName:  z.string().min(1, "Child last name is required.").max(64).trim(),
  grade: z.coerce
    .number()
    .int()
    .min(1, "Grade must be between 1 and 8.")
    .max(8, "Grade must be between 1 and 8."),
  dateOfBirth: z.coerce.date({
    error: "Date of birth is invalid.",
  }),

  // Parent fields
  parentFirstName: z.string().min(1, "Parent first name is required.").max(64).trim(),
  parentLastName:  z.string().min(1, "Parent last name is required.").max(64).trim(),
  parentEmail: z
    .string()
    .email("Parent email is invalid.")
    .max(254)
    .trim()
    .toLowerCase(),
  parentPhone: z
    .string()
    .min(7,  "Phone number is too short.")
    .max(20, "Phone number is too long.")
    .trim(),

  // Payment fields
  paymentMethod: z.enum(["transaction_id", "receipt_upload"] as const, {
    error: "Invalid payment method.",
  }),
  transactionId:  z.string().max(128).trim().optional(),
  receiptFileId:  z.string().max(128).trim().optional(),
  // Optional favourite subjects — comma-separated string from FormData,
  // split and validated server-side. Empty string means no subjects selected.
  subjects: z.string().max(500).optional(),
}).superRefine((data, ctx) => {
  // Cross-field: transaction_id requires transactionId
  if (data.paymentMethod === "transaction_id" && !data.transactionId) {
    ctx.addIssue({
      code: "custom",
      message: "Transaction ID is required.",
      path: ["transactionId"],
    });
  }
  // Cross-field: receipt_upload requires receiptFileId
  if (data.paymentMethod === "receipt_upload" && !data.receiptFileId) {
    ctx.addIssue({
      code: "custom",
      message: "Receipt upload is required. Please upload your receipt first.",
      path: ["receiptFileId"],
    });
  }
  // Date of birth must be in the past
  const now = new Date();
  if (data.dateOfBirth >= now) {
    ctx.addIssue({
      code: "custom",
      message: "Date of birth must be in the past.",
      path: ["dateOfBirth"],
    });
  }
  // Reasonable age ceiling — catches obvious bad input
  if (now.getFullYear() - data.dateOfBirth.getFullYear() > 25) {
    ctx.addIssue({
      code: "custom",
      message: "Date of birth seems too far in the past.",
      path: ["dateOfBirth"],
    });
  }
});

export async function POST(req: Request) {
  try {
    // ── Rate limit ────────────────────────────────────────────────────────
    const ip = getClientIp(req);
    const rl = rateLimit(`register:${ip}`, RATE_LIMITS.registration);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429 }
      );
    }

    // ── Parse FormData → plain object → Zod ──────────────────────────────
    const form = await req.formData();
    const raw: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      // Only accept string fields — ignore any unexpected File entries
      if (typeof value === "string") raw[key] = value;
    }

    const parsed = parseBody(RegistrationSchema, raw, "register");
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    // Parse subjects from comma-separated string into validated array
    const VALID_SUBJECTS = [
      "English", "Mathematics", "Science", "Social Studies",
      "Arts", "Music", "Physical Education", "Technology",
    ];
    const subjects = data.subjects
      ? data.subjects
          .split(",")
          .map((s) => s.trim())
          .filter((s) => VALID_SUBJECTS.includes(s))
      : [];

    // ── Receipt file verification (DB check — outside schema) ─────────────
    // Zod confirms the field is present; here we verify it actually exists
    // in the DB and is COMPLETED. This is business logic, not shape validation.
    if (data.paymentMethod === "receipt_upload") {
      const fileRecord = await prisma.file.findUnique({
        where: { id: data.receiptFileId! },
        select: { id: true, uploadStatus: true },
      });
      if (!fileRecord) {
        return NextResponse.json(
          { error: "Receipt file not found." },
          { status: 400 }
        );
      }
      if (fileRecord.uploadStatus !== "COMPLETED") {
        return NextResponse.json(
          { error: "Receipt upload is still processing. Please wait and try again." },
          { status: 400 }
        );
      }
    }

    // ── Upsert parent ─────────────────────────────────────────────────────
    const parent = await prisma.parent.upsert({
      where: {
        parents_email_phone_unique: {
          email: data.parentEmail,
          phone: data.parentPhone,
        },
      },
      update: {
        firstName: data.parentFirstName,
        lastName:  data.parentLastName,
      },
      create: {
        firstName: data.parentFirstName,
        lastName:  data.parentLastName,
        email:     data.parentEmail,
        phone:     data.parentPhone,
      },
    });

    // ── Create child + payment in transaction ─────────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      const child = await tx.child.create({
        data: {
          parentId:       parent.id,
          childFirstName: data.childFirstName,
          childLastName:  data.childLastName,
          grade:          data.grade,
          dateOfBirth:    data.dateOfBirth,
          subjects,
          status:         "pending_payment",
        },
      });

      // Link the uploaded receipt file to this child
      if (data.receiptFileId) {
        await tx.file.update({
          where: { id: data.receiptFileId },
          data: { uploadedByChildId: child.id },
        });
      }

      const payment = await tx.payment.create({
        data: {
          childId:       child.id,
          method:        data.paymentMethod,
          status:        "pending",
          transactionId: data.paymentMethod === "transaction_id"
            ? data.transactionId ?? null
            : null,
          receiptFileId: data.paymentMethod === "receipt_upload"
            ? data.receiptFileId ?? null
            : null,
        },
      });

      return { child, payment };
    });

    return NextResponse.json({
      ok: true,
      childId:   result.child.id,
      paymentId: result.payment.id,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}