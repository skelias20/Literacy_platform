// app/api/admin/profile-change-requests/[id]/route.ts
// GET   — full detail including snapshotBefore for diff view
// PATCH — approve (applies changes to Child/Parent) or reject (with optional note)

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/parseBody";
import { requireAdminAuth } from "@/lib/serverAuth";

const ReviewSchema = z.object({
  action:    z.enum(["approve", "reject"]),
  adminNote: z.string().max(500).trim().optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await requireAdminAuth();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;

    const request = await prisma.profileChangeRequest.findUnique({
      where: { id },
      select: {
        id:               true,
        status:           true,
        requestedChanges: true,
        snapshotBefore:   true,
        requestedAt:      true,
        reviewedAt:       true,
        adminNote:        true,
        child: {
          select: {
            id:             true,
            childFirstName: true,
            childLastName:  true,
            grade:          true,
            parentId:       true,
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
        },
        reviewedByAdmin: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!request) return NextResponse.json({ error: "Not found." }, { status: 404 });

    return NextResponse.json({ request });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await requireAdminAuth(req);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;

    const parsed = parseBody(
      ReviewSchema,
      await req.json().catch(() => null),
      "admin/profile-change-requests PATCH"
    );
    if (!parsed.ok) return parsed.response;
    const { action, adminNote } = parsed.data;

    const request = await prisma.profileChangeRequest.findUnique({
      where: { id },
      select: {
        id:               true,
        status:           true,
        requestedChanges: true,
        childId:          true,
        child: {
          select: { parentId: true },
        },
      },
    });

    if (!request) return NextResponse.json({ error: "Not found." }, { status: 404 });

    if (request.status !== "PENDING") {
      return NextResponse.json(
        { error: "This request has already been reviewed." },
        { status: 409 }
      );
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Mark request reviewed
      await tx.profileChangeRequest.update({
        where: { id },
        data: {
          status:           action === "approve" ? "APPROVED" : "REJECTED",
          reviewedAt:       now,
          reviewedByAdminId: adminId,
          adminNote:        adminNote ?? null,
        },
      });

      if (action === "approve") {
        // Apply the requested changes to Child and Parent
        const changes = request.requestedChanges as Record<string, unknown>;

        const childFields: Record<string, unknown> = {};
        const parentFields: Record<string, unknown> = {};

        if (changes.childFirstName !== undefined) childFields.childFirstName = changes.childFirstName;
        if (changes.childLastName  !== undefined) childFields.childLastName  = changes.childLastName;
        if (changes.grade          !== undefined) childFields.grade          = changes.grade;
        if (changes.subjects       !== undefined) childFields.subjects       = changes.subjects;

        if (changes.parentFirstName !== undefined) parentFields.firstName = changes.parentFirstName;
        if (changes.parentLastName  !== undefined) parentFields.lastName  = changes.parentLastName;
        if (changes.parentEmail     !== undefined) parentFields.email     = changes.parentEmail;
        if (changes.parentPhone     !== undefined) parentFields.phone     = changes.parentPhone;

        if (Object.keys(childFields).length > 0) {
          await tx.child.update({ where: { id: request.childId }, data: childFields });
        }
        if (Object.keys(parentFields).length > 0) {
          await tx.parent.update({ where: { id: request.child.parentId }, data: parentFields });
        }
      }

      // Audit log
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: action === "approve" ? "PROFILE_CHANGE_APPROVED" : "PROFILE_CHANGE_REJECTED",
          targetChildId: request.childId,
          metadata: {
            requestId:       id,
            requestedFields: Object.keys(request.requestedChanges as object),
            adminNote:       adminNote ?? null,
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
