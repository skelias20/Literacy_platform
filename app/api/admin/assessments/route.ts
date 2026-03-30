// app/api/admin/assessments/route.ts
// Initial assessments are shown as soon as ANY session is submitted (not just the final one).
// This lets admin review artifacts from session 1 while session 2 is still pending.
// Deduplication: only one list entry per child — the highest submitted session number.
// Guard against stale entries: filter by child status (assessment_required / pending_level_review).
// Once level is assigned, child becomes "active" and disappears from both filters.

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

const assessmentSelect = {
  id: true,
  kind: true,
  sessionNumber: true,
  taskFormat: true,
  submittedAt: true,
  assignedLevel: true,
  child: {
    select: {
      id: true,
      childFirstName: true,
      childLastName: true,
      grade: true,
      status: true,
      level: true,
      parent: {
        select: { email: true, phone: true, firstName: true, lastName: true },
      },
    },
  },
} as const;

export async function GET(req: Request) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const kindFilter = searchParams.get("kind");

  const config = await prisma.assessmentConfig.findFirst({
    orderBy: { createdAt: "asc" },
    select: { initialSessionCount: true },
  });
  const initialSessionCount = config?.initialSessionCount ?? 1;

  // ── Initial assessments ───────────────────────────────────────────────
  // Show as soon as session 1 is submitted — admin shouldn't wait until all sessions done.
  // Filter by child status to avoid showing stale entries after level assignment.
  const allSubmittedInitial = (kindFilter === "periodic") ? [] : await prisma.assessment.findMany({
    where: {
      kind: "initial",
      submittedAt: { not: null },
      child: {
        archivedAt: null,
        status: { in: ["assessment_required", "pending_level_review"] },
      },
    },
    orderBy: { sessionNumber: "desc" },
    select: assessmentSelect,
  });

  // Deduplicate by child: keep the highest submitted sessionNumber per child.
  const seenChildren = new Set<string>();
  const initialAssessments: typeof allSubmittedInitial = [];
  for (const a of allSubmittedInitial) {
    if (!seenChildren.has(a.child.id)) {
      seenChildren.add(a.child.id);
      initialAssessments.push(a);
    }
  }

  // ── Periodic assessments ──────────────────────────────────────────────
  const periodicAssessments = (kindFilter === "initial") ? [] : await prisma.assessment.findMany({
    where: {
      kind: "periodic",
      submittedAt: { not: null },
      isLatest: true,
      assignedLevel: null,
      child: { archivedAt: null },
    },
    orderBy: { submittedAt: "desc" },
    select: assessmentSelect,
  });

  // ── Combine and sort ──────────────────────────────────────────────────
  let assessments;
  if (kindFilter === "initial") {
    assessments = initialAssessments;
  } else if (kindFilter === "periodic") {
    assessments = periodicAssessments;
  } else {
    assessments = [...initialAssessments, ...periodicAssessments].sort(
      (a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0)
    );
  }

  // Count triggered periodic assessments not yet submitted (for admin notice)
  const pendingPeriodicCount = await prisma.assessment.count({
    where: {
      kind: "periodic",
      isLatest: true,
      submittedAt: null,
      child: { status: "active", archivedAt: null },
    },
  });

  return NextResponse.json({ assessments, pendingPeriodicCount, totalSessions: initialSessionCount });
}
