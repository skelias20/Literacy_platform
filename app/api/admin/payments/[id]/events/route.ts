import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const adminId = await requireAdminAuth();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    select: { childId: true },
  });
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const events = await prisma.paymentEvent.findMany({
    where: { childId: payment.childId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      eventType: true,
      statusBefore: true,
      statusAfter: true,
      method: true,
      reference: true,
      notes: true,
      createdAt: true,
      admin: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  return NextResponse.json({ events });
}
