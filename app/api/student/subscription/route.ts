// app/api/student/subscription/route.ts
// GET /api/student/subscription
// Returns the student's current subscription state:
//   - current period (start, end, daysRemaining)
//   - whether they are in grace period or hard-locked
//   - whether a pending renewal exists
//   - fee + currency from BillingConfig
//   - renewalWindowDays (so client can decide when to enable the Renew button)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("student_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let childId: string;
    try {
      childId = verifyStudentJwt(token).childId;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [child, config, pendingRenewal] = await Promise.all([
      prisma.child.findUnique({
        where: { id: childId },
        select: { subscriptionExpiresAt: true, status: true },
      }),
      prisma.billingConfig.findFirst(),
      prisma.renewalPayment.findFirst({
        where: { childId, status: "pending" },
        select: { id: true, createdAt: true },
      }),
    ]);

    if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const gracePeriodDays   = config?.gracePeriodDays   ?? 7;
    const renewalWindowDays = config?.renewalWindowDays  ?? 7;
    const monthlyFee        = config?.monthlyFee         ?? null;
    const currency          = config?.currency           ?? "USD";

    const now = new Date();
    const expiresAt = child.subscriptionExpiresAt;

    let accessState: "active" | "grace" | "locked" | "grandfathered" = "grandfathered";
    let daysRemaining: number | null = null;

    if (expiresAt !== null) {
      const msRemaining = expiresAt.getTime() - now.getTime();
      daysRemaining = Math.ceil(msRemaining / 86_400_000);

      if (now <= expiresAt) {
        accessState = "active";
      } else {
        const hardLockAt = new Date(expiresAt.getTime() + gracePeriodDays * 86_400_000);
        accessState = now <= hardLockAt ? "grace" : "locked";
      }
    }

    return NextResponse.json({
      subscriptionExpiresAt:  expiresAt?.toISOString() ?? null,
      accessState,
      daysRemaining,
      gracePeriodDays,
      renewalWindowDays,
      monthlyFee:   monthlyFee !== null ? monthlyFee.toString() : null,
      currency,
      pendingRenewal: pendingRenewal
        ? { id: pendingRenewal.id, submittedAt: pendingRenewal.createdAt.toISOString() }
        : null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
