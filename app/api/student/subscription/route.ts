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
import { requireStudentAuth } from "@/lib/serverAuth";
import { sendRenewalReminderEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function GET() {
  try {
    const student = await requireStudentAuth();
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const childId = student.childId;

    const [child, config, pendingRenewal] = await Promise.all([
      prisma.child.findUnique({
        where: { id: childId },
        select: {
          subscriptionExpiresAt: true,
          status: true,
          childFirstName: true,
          archivedAt: true,
          lastRenewalReminderAt: true,
          parent: { select: { email: true } },
        },
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

    // Event 5 — Subscription expiry reminder (fire-and-forget, 3-day cooldown).
    // Only fires when a real expiry date exists and is within the renewal window.
    if (expiresAt !== null && daysRemaining !== null && daysRemaining <= renewalWindowDays) {
      const reminderAgeMs = child.lastRenewalReminderAt
        ? Date.now() - child.lastRenewalReminderAt.getTime()
        : Infinity;
      const reminderAgeDays = reminderAgeMs / 86_400_000;

      if (reminderAgeDays > 3) {
        void sendRenewalReminderEmail(
          child.parent.email,
          child.childFirstName,
          expiresAt,
          child.archivedAt
        ).catch(console.error);
        // Update timestamp in background — failure is non-critical.
        void prisma.child
          .update({ where: { id: childId }, data: { lastRenewalReminderAt: new Date() } })
          .catch(console.error);
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
