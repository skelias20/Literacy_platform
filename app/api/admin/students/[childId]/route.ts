// app/api/admin/students/[childId]/route.ts
// GET  — full student detail including parent contact and RP total
// PATCH — update editable fields (child name/grade/dob, parent contact)
//         Both child and parent updates run in one transaction.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try {
    return verifyAdminJwt(token).adminId;
  } catch {
    return null;
  }
}

// ── Edit schema — only fields admin is allowed to correct ────────────────
// Status and level are NOT here — those are workflow-controlled.
// Username and passwordHash are NOT here — credential system is separate.
const StudentPatchSchema = z.object({
  // Child corrections
  childFirstName: z.string().min(1).max(64).trim().optional(),
  childLastName:  z.string().min(1).max(64).trim().optional(),
  grade:          z.number().int().min(1).max(12).optional(),
  dateOfBirth:    z.coerce.date().optional(),
  subjects:       z.array(z.string().max(64)).max(8).optional(),
  // Parent corrections — all four fields validated if any are present
  parentFirstName: z.string().min(1).max(64).trim().optional(),
  parentLastName:  z.string().min(1).max(64).trim().optional(),
  parentEmail:     z.string().email().max(254).trim().toLowerCase().optional(),
  parentPhone:     z.string().min(7).max(20).trim().optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: "At least one field must be provided." }
);

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ childId: string }> }
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { childId } = await ctx.params;

    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: {
        id:                   true,
        childFirstName:       true,
        childLastName:        true,
        grade:                true,
        dateOfBirth:          true,
        username:             true,
        status:               true,
        level:                true,
        subjects:             true,
        createdAt:            true,
        updatedAt:            true,
        credentialsCreatedAt: true,
        levelAssignedAt:      true,
        lastDailySubmissionAt: true,
        parent: {
          select: {
            id:        true,
            firstName: true,
            lastName:  true,
            email:     true,
            phone:     true,
          },
        },
      },
    });

    if (!child) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // RP total — single aggregate, not a relation traversal
    const rpAgg = await prisma.rpEvent.aggregate({
      where: { childId },
      _sum: { delta: true },
    });
    const totalRp = rpAgg._sum.delta ?? 0;

    // Open periodic assessment — any unsubmitted periodic session
    const openPeriodicCount = await prisma.assessment.count({
      where: { childId, kind: "periodic", submittedAt: null },
    });

    return NextResponse.json({ child: { ...child, totalRp, hasOpenPeriodic: openPeriodicCount > 0 } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ childId: string }> }
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { childId } = await ctx.params;

    const parsed = parseBody(
      StudentPatchSchema,
      await req.json().catch(() => null),
      "admin/students PATCH"
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // Verify child exists before any update
    const existing = await prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, parentId: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // ── Validate dateOfBirth business rules if provided ───────────────────
    if (body.dateOfBirth) {
      const now = new Date();
      if (body.dateOfBirth >= now) {
        return NextResponse.json(
          { error: "Date of birth must be in the past." },
          { status: 400 }
        );
      }
      if (now.getFullYear() - body.dateOfBirth.getFullYear() > 25) {
        return NextResponse.json(
          { error: "Date of birth seems too far in the past." },
          { status: 400 }
        );
      }
    }

    // ── Atomic update — child and parent in one transaction ───────────────
    const hasChildFields  = body.childFirstName || body.childLastName ||
                            body.grade !== undefined || body.dateOfBirth ||
                            body.subjects !== undefined;
    const hasParentFields = body.parentFirstName || body.parentLastName ||
                            body.parentEmail || body.parentPhone;

    await prisma.$transaction(async (tx) => {
      if (hasChildFields) {
        await tx.child.update({
          where: { id: childId },
          data: {
            ...(body.childFirstName ? { childFirstName: body.childFirstName } : {}),
            ...(body.childLastName  ? { childLastName:  body.childLastName  } : {}),
            ...(body.grade !== undefined ? { grade: body.grade }             : {}),
            ...(body.dateOfBirth    ? { dateOfBirth: body.dateOfBirth }      : {}),
            ...(body.subjects !== undefined ? { subjects: body.subjects }    : {}),
          },
        });
      }

      if (hasParentFields) {
        await tx.parent.update({
          where: { id: existing.parentId },
          data: {
            ...(body.parentFirstName ? { firstName: body.parentFirstName } : {}),
            ...(body.parentLastName  ? { lastName:  body.parentLastName  } : {}),
            ...(body.parentEmail     ? { email:     body.parentEmail     } : {}),
            ...(body.parentPhone     ? { phone:     body.parentPhone     } : {}),
          },
        });
      }

      // Audit log — records which fields were changed and by whom
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "STUDENT_PROFILE_EDITED",
          targetChildId: childId,
          metadata: {
            updatedFields: Object.keys(body).filter(
              (k) => body[k as keyof typeof body] !== undefined
            ),
          },
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}