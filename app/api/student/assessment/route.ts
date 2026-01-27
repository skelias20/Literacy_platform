import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyStudentJwt } from "@/lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = verifyStudentJwt(token);

  const child = await prisma.child.findUnique({ where: { id: payload.childId } });
  if (!child) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only allow assessment if required (or already started)
  if (child.status !== "assessment_required" && child.status !== "active") {
    return NextResponse.json({ error: "Assessment not available" }, { status: 403 });
  }

  // Ensure initial assessment row exists
  const assessment = await prisma.assessment.upsert({
    where: { childId_kind: { childId: child.id, kind: "initial" } },
    update: {
      startedAt: child.status === "assessment_required" ? new Date() : undefined,
    },
    create: {
      childId: child.id,
      kind: "initial",
      startedAt: new Date(),
    },
  });

  const content = await prisma.contentItem.findMany({
    where: { isAssessmentDefault: true },
    orderBy: [{ skill: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      skill: true,
      type: true,
      textBody: true,
      assetUrl: true,
      mimeType: true,
    },
  });

  return NextResponse.json({ assessmentId: assessment.id, content });
}
