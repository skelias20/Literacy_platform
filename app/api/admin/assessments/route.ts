import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
// api/admin/assessments/route.ts
export async function GET() {
  const assessments = await prisma.assessment.findMany({
    where: {
      kind: "initial",
      submittedAt: { not: null },
    },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
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
          parent: { select: { email: true, phone: true } },
        },
      },
    },
  });
  

  return NextResponse.json({ assessments });
}
