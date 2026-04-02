// app/api/admin/profile-change-requests/route.ts
// GET — list all profile change requests, optionally filtered by status
// Default: returns PENDING requests first, then others sorted by requestedAt desc

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

export async function GET(req: Request) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status"); // "PENDING" | "APPROVED" | "REJECTED" | null (all)

    const requests = await prisma.profileChangeRequest.findMany({
      where: statusFilter ? { status: statusFilter as "PENDING" | "APPROVED" | "REJECTED" } : undefined,
      orderBy: [
        { status: "asc" },   // PENDING sorts before APPROVED / REJECTED alphabetically
        { requestedAt: "desc" },
      ],
      select: {
        id:               true,
        status:           true,
        requestedChanges: true,
        requestedAt:      true,
        reviewedAt:       true,
        adminNote:        true,
        child: {
          select: {
            id:             true,
            childFirstName: true,
            childLastName:  true,
            grade:          true,
          },
        },
        reviewedByAdmin: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    return NextResponse.json({ requests });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
