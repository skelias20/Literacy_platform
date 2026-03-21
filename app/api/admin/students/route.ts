// app/api/admin/students/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";

const VALID_SORT = ["name", "grade", "status", "level", "createdAt", "rp"] as const;

const ListQuerySchema = z.object({
  search:       z.string().max(100).trim().optional(),
  sort:         z.enum(VALID_SORT).optional().default("name"),
  order:        z.enum(["asc", "desc"]).optional().default("asc"),
  showArchived: z.enum(["true", "false"]).optional().default("false"),
});

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

    const { searchParams } = new URL(req.url);
    const parsed = parseBody(
      ListQuerySchema,
      {
        search:       searchParams.get("search")       ?? undefined,
        sort:         searchParams.get("sort")         ?? undefined,
        order:        searchParams.get("order")        ?? undefined,
        showArchived: searchParams.get("showArchived") ?? undefined,
      },
      "admin/students GET"
    );
    if (!parsed.ok) return parsed.response;
    const { search, sort, order, showArchived } = parsed.data;

    const includeArchived = showArchived === "true";

    // ── Build Prisma orderBy ──────────────────────────────────────────────
    const prismaSort = sort === "rp" || sort === "name"
      ? undefined
      : sort === "grade"     ? { grade: order }
      : sort === "status"    ? { status: order }
      : sort === "level"     ? { level: order }
      : sort === "createdAt" ? { createdAt: order }
      : undefined;

    // ── Main list query ───────────────────────────────────────────────────
    const children = await prisma.child.findMany({
      where: {
        // By default hide archived students — show only when explicitly requested
        ...(!includeArchived ? { archivedAt: null } : {}),
        ...(search
          ? {
              OR: [
                { childFirstName: { contains: search, mode: "insensitive" } },
                { childLastName:  { contains: search, mode: "insensitive" } },
                { username:       { contains: search, mode: "insensitive" } },
                { parent: {
                    OR: [
                      { firstName: { contains: search, mode: "insensitive" } },
                      { lastName:  { contains: search, mode: "insensitive" } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id:             true,
        childFirstName: true,
        childLastName:  true,
        grade:          true,
        status:         true,
        level:          true,
        username:       true,
        createdAt:      true,
        archivedAt:     true,
        parent: {
          select: {
            firstName: true,
            lastName:  true,
          },
        },
      },
      orderBy: prismaSort ?? { childLastName: "asc" },
    });

    // ── RP totals — single groupBy, no N+1 ───────────────────────────────
    const rpGroups = await prisma.rpEvent.groupBy({
      by: ["childId"],
      where: { childId: { in: children.map((c) => c.id) } },
      _sum: { delta: true },
    });
    const rpMap = new Map(rpGroups.map((r) => [r.childId, r._sum.delta ?? 0]));

    let students = children.map((c) => ({
      ...c,
      totalRp: rpMap.get(c.id) ?? 0,
    }));

    // ── Post-merge sorts ──────────────────────────────────────────────────
    if (sort === "name") {
      students = students.sort((a, b) => {
        const nameA = `${a.childLastName} ${a.childFirstName}`.toLowerCase();
        const nameB = `${b.childLastName} ${b.childFirstName}`.toLowerCase();
        return order === "asc"
          ? nameA.localeCompare(nameB)
          : nameB.localeCompare(nameA);
      });
    } else if (sort === "rp") {
      students = students.sort((a, b) =>
        order === "asc" ? a.totalRp - b.totalRp : b.totalRp - a.totalRp
      );
    }

    return NextResponse.json({ students });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}