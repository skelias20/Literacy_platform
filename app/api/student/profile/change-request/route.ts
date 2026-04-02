// app/api/student/profile/change-request/route.ts
// GET  — returns the student's most recent profile change request (any status)
// POST — submits a new change request (one PENDING at a time enforced here)

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";

async function requireStudent(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return null;
  try {
    return verifyStudentJwt(token).childId;
  } catch {
    return null;
  }
}

const ChangeRequestSchema = z.object({
  childFirstName:  z.string().min(1).max(64).trim().optional(),
  childLastName:   z.string().min(1).max(64).trim().optional(),
  grade:           z.number().int().min(1).max(12).optional(),
  subjects:        z.array(z.string().max(64)).max(8).optional(),
  parentFirstName: z.string().min(1).max(64).trim().optional(),
  parentLastName:  z.string().min(1).max(64).trim().optional(),
  parentEmail:     z.string().email().max(254).trim().toLowerCase().optional(),
  parentPhone:     z.string().min(7).max(20).trim().optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: "At least one field must be requested for change." }
);

// ── GET ───────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const childId = await requireStudent();
    if (!childId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const request = await prisma.profileChangeRequest.findFirst({
      where: { childId },
      orderBy: { requestedAt: "desc" },
      select: {
        id:               true,
        status:           true,
        requestedChanges: true,
        snapshotBefore:   true,
        requestedAt:      true,
        reviewedAt:       true,
        adminNote:        true,
      },
    });

    return NextResponse.json({ request });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const childId = await requireStudent();
    if (!childId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(
      ChangeRequestSchema,
      await req.json().catch(() => null),
      "student/profile/change-request POST"
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // One pending request at a time
    const existing = await prisma.profileChangeRequest.findFirst({
      where: { childId, status: "PENDING" },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "You already have a pending change request. Please wait for admin review." },
        { status: 409 }
      );
    }

    // Snapshot current values for admin diff
    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: {
        childFirstName: true,
        childLastName:  true,
        grade:          true,
        subjects:       true,
        parent: {
          select: {
            firstName: true,
            lastName:  true,
            email:     true,
            phone:     true,
          },
        },
      },
    });
    if (!child) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const snapshotBefore = {
      childFirstName:  child.childFirstName,
      childLastName:   child.childLastName,
      grade:           child.grade,
      subjects:        child.subjects,
      parentFirstName: child.parent.firstName,
      parentLastName:  child.parent.lastName,
      parentEmail:     child.parent.email,
      parentPhone:     child.parent.phone,
    };

    // Only store the fields that were actually requested
    const requestedChanges: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) requestedChanges[k] = v;
    }

    // The ProfileChangeRequest row itself is the audit trail for student-initiated requests.
    // Admin-side approve/reject will write to AdminAuditLog with the actual adminId.
    await prisma.profileChangeRequest.create({
      data: {
        childId,
        requestedChanges: requestedChanges as Prisma.InputJsonValue,
        snapshotBefore:   snapshotBefore   as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
