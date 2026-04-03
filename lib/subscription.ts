// lib/subscription.ts
// Shared subscription access check for student submission routes.
// Does NOT modify Child.status — billing is orthogonal to the state machine.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export type SubscriptionCheckResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * Checks whether a student may submit work based on their subscription state.
 *
 * Rules:
 * - Only applies to `active` students — pre-active students are never blocked.
 * - subscriptionExpiresAt is null → grandfathered / no billing expiry → allow.
 * - Within expiry → allow.
 * - Within grace period (expiry < now ≤ hardLockAt) → allow (banner shown client-side).
 * - Past hard lock (now > hardLockAt) → block with 402.
 */
export async function checkSubscriptionAccess(child: {
  status: string;
  subscriptionExpiresAt: Date | null;
}): Promise<SubscriptionCheckResult> {
  // Pre-active students are never blocked by billing.
  if (child.status !== "active") return { ok: true };

  // null = grandfathered / admin override — treat as valid indefinitely.
  if (child.subscriptionExpiresAt === null) return { ok: true };

  const now = new Date();
  const expiresAt = child.subscriptionExpiresAt;

  // Active subscription.
  if (now <= expiresAt) return { ok: true };

  // Expired — fetch grace period from config (single-row table, fast).
  const config = await prisma.billingConfig.findFirst();
  const gracePeriodDays = config?.gracePeriodDays ?? 7;
  const hardLockAt = new Date(expiresAt.getTime() + gracePeriodDays * 86_400_000);

  // Within grace period — still allowed.
  if (now <= hardLockAt) return { ok: true };

  // Past hard lock — block submissions only.
  return {
    ok: false,
    response: NextResponse.json(
      { error: "Your subscription has expired. Please renew to continue submitting work." },
      { status: 402 }
    ),
  };
}
