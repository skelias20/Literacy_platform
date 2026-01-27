import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const children = await prisma.child.findMany({
    where: {
      status: "approved_pending_login",
    },
    orderBy: { createdAt: "asc" },
    include: {
      parent: true,
    },
  });

  return NextResponse.json({ children });
}
