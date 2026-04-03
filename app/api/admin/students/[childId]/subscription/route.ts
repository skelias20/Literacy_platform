// app/api/admin/students/[childId]/subscription/route.ts
// PATCH /api/admin/students/[childId]/subscription
// Admin manual override: set Child.subscriptionExpiresAt directly.
// Used for grandfathering, corrections, or manual extensions.
// null clears the expiry (grandfathers the account indefinitely).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { z } from "zod";

export const runtime = "nodejs";

const OverrideSchema = z.object({
  // ISO date string or null. null = clear expiry (grandfather).
  subscriptionExpiresAt: z.string().datetime().nullable(),
  reason: z.string().max(500).optional().default(""),
});

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try { return verifyAdminJwt(token).adminId; }
  catch { return null; }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ childId: string }> }
) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { childId } = await ctx.params;

    const parsed = parseBody(OverrideSchema, await req.json().catch(() => null), "students/subscription");
    if (!parsed.ok) return parsed.response;
    const { subscriptionExpiresAt, reason } = parsed.data;

    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, subscriptionExpiresAt: true },
    });
    if (!child) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const newExpiry = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;

    await prisma.$transaction(async (tx) => {
      await tx.child.update({
        where: { id: childId },
        data: { subscriptionExpiresAt: newExpiry },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "SUBSCRIPTION_OVERRIDDEN",
          targetChildId: childId,
          metadata: {
            previousExpiry: child.subscriptionExpiresAt?.toISOString() ?? null,
            newExpiry:      newExpiry?.toISOString() ?? null,
            reason:         reason || null,
          },
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
