// app/api/admin/assessments/history/route.ts
// Paginated list of all resolved assessments (assignedLevel IS NOT NULL).
// Returns scalar fields only — artifacts are NOT fetched here.
// Artifacts load lazily via /api/admin/assessments/[id] when the admin expands a row.
// Filters: kind, search (student name ILIKE), dateFrom, dateTo.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";

export const runtime = "nodejs";

const PAGE_SIZE = 20;

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try { return verifyAdminJwt(token).adminId; }
  catch { return null; }
}

export async function GET(req: Request) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const kind     = searchParams.get("kind");
  const search   = (searchParams.get("search") ?? "").trim();
  const dateFrom = searchParams.get("dateFrom");
  const dateTo   = searchParams.get("dateTo");
  const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));

  // Build date range for submittedAt filter.
  const dateRange: { gte?: Date; lte?: Date } = {};
  if (dateFrom) dateRange.gte = new Date(dateFrom);
  if (dateTo)   dateRange.lte = new Date(dateTo);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    assignedLevel: { not: null },
    submittedAt:   { not: null, ...dateRange },
    child:         { archivedAt: null },
  };

  if (kind === "initial" || kind === "periodic") {
    where.kind = kind;
  }

  if (search) {
    where.child.OR = [
      { childFirstName: { contains: search, mode: "insensitive" } },
      { childLastName:  { contains: search, mode: "insensitive" } },
    ];
  }

  const [total, history] = await Promise.all([
    prisma.assessment.count({ where }),
    prisma.assessment.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
      select: {
        id:            true,
        kind:          true,
        sessionNumber: true,
        taskFormat:    true,
        submittedAt:   true,
        assignedLevel: true,
        reviewedAt:    true,
        child: {
          select: {
            id:             true,
            childFirstName: true,
            childLastName:  true,
            grade:          true,
            level:          true,
            parent: {
              select: {
                email:     true,
                phone:     true,
                firstName: true,
                lastName:  true,
              },
            },
          },
        },
      },
    }),
  ]);

  return NextResponse.json({ history, total, page, pageSize: PAGE_SIZE });
}
