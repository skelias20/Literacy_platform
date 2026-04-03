import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { verifyAdminJwt(token); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

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
