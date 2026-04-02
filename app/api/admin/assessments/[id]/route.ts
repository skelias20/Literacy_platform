// app/api/admin/assessments/[id]/route.ts
// Returns the clicked assessment plus ALL sessions for the same child+kind,
// so the admin can review the complete session history when making a level decision.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";

export const runtime = "nodejs";

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try { return verifyAdminJwt(token).adminId; }
  catch { return null; }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const assessment = await prisma.assessment.findUnique({
    where: { id },
    include: {
      child: { include: { parent: true } },
      artifacts: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!assessment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load all sessions for this child + kind so admin sees the full picture.
  // For initial assessments this returns sessions 1..N.
  // For periodic: filter to the same cycle so admin sees sessions 1..periodicSessionCount
  // of the current cycle, not all historical periodic evaluations.
  const allSessions = await prisma.assessment.findMany({
    where: {
      childId: assessment.childId,
      kind: assessment.kind,
      ...(assessment.kind === "periodic" && assessment.periodicCycleNumber != null
        ? { periodicCycleNumber: assessment.periodicCycleNumber }
        : {}),
    },
    orderBy: { sessionNumber: "asc" },
    select: {
      id: true,
      sessionNumber: true,
      periodicCycleNumber: true,
      isLatest: true,
      submittedAt: true,
      assignedLevel: true,
      taskFormat: true,
      artifacts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          skill: true,
          textBody: true,
          fileId: true,
          answersJson: true,
          createdAt: true,
          contentItemId: true,
          contentItem: {
            select: { id: true, title: true, skill: true, type: true, textBody: true, assetUrl: true },
          },
        },
      },
    },
  });

  return NextResponse.json({ assessment, allSessions });
}