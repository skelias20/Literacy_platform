// app/api/admin/daily-tasks/[taskId]/route.ts
// DELETE: removes a daily task if no student has completed it.
// Cascade rules in schema handle DailyTaskContent, DailySubmission, and DailySubmissionArtifact.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  try {
    const adminId = await requireAdminAuth(req);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await ctx.params;

    const task = await prisma.dailyTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        _count: { select: { submissions: { where: { isCompleted: true } } } },
      },
    });

    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

    if (task._count.submissions > 0) {
      return NextResponse.json(
        { error: "Cannot delete: one or more students have already completed this task." },
        { status: 409 }
      );
    }

    // Schema cascades: deleting DailyTask removes DailyTaskContent, DailySubmission,
    // and DailySubmissionArtifact automatically. RpEvents and AdminAuditLogs use SetNull.
    await prisma.dailyTask.delete({ where: { id: taskId } });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
