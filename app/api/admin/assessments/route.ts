import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const assessments = await prisma.assessment.findMany({
    where: {
      kind: "initial",
      submittedAt: { not: null },
    },
    orderBy: { submittedAt: "desc" },
    include: {
      child: { include: { parent: true } },
    },
  });

  return NextResponse.json({ assessments });
}
