import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
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

  return NextResponse.json({ assessment });
}
