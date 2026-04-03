// __tests__/billing/subscription-gate.test.ts
// Section 9 — Subscription gate on student submission routes.
// Tests lib/subscription.ts::checkSubscriptionAccess directly.
// This is the highest-impact area: wrong logic silently blocks active students.

import { daysFromNow, daysAgo } from "../helpers/mocks";

// Mock prisma before importing the module under test.
const mockFindFirst = jest.fn();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    billingConfig: { findFirst: mockFindFirst },
  },
}));

import { checkSubscriptionAccess } from "@/lib/subscription";

const DEFAULT_GRACE_DAYS = 7;

describe("checkSubscriptionAccess", () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue(null); // Default: no BillingConfig row
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Pre-active students: never blocked ──────────────────────────────────

  it("allows pre-active student (assessment_required) even with past expiry", async () => {
    const result = await checkSubscriptionAccess({
      status: "assessment_required",
      subscriptionExpiresAt: daysAgo(90),
    });
    expect(result.ok).toBe(true);
  });

  it("allows pre-active student (pending_level_review) even with past expiry", async () => {
    const result = await checkSubscriptionAccess({
      status: "pending_level_review",
      subscriptionExpiresAt: daysAgo(90),
    });
    expect(result.ok).toBe(true);
  });

  it("allows approved_pending_login status without checking expiry", async () => {
    const result = await checkSubscriptionAccess({
      status: "approved_pending_login",
      subscriptionExpiresAt: daysAgo(30),
    });
    expect(result.ok).toBe(true);
  });

  // ── Grandfathered (null expiry) ─────────────────────────────────────────

  it("allows active student with null subscriptionExpiresAt (grandfathered)", async () => {
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: null,
    });
    expect(result.ok).toBe(true);
  });

  it("does not call billingConfig.findFirst for grandfathered student", async () => {
    await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: null,
    });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  // ── Active subscription ─────────────────────────────────────────────────

  it("allows active student with valid subscription (expiry in future)", async () => {
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: daysFromNow(15),
    });
    expect(result.ok).toBe(true);
  });

  it("allows active student with expiry exactly at this moment (boundary)", async () => {
    // Slightly in the future to avoid race conditions in the test itself
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: new Date(Date.now() + 1000),
    });
    expect(result.ok).toBe(true);
  });

  // ── Grace period ────────────────────────────────────────────────────────

  it("allows active student within default grace period (3 days past expiry, 7-day grace)", async () => {
    // Default: no BillingConfig → gracePeriodDays = 7
    mockFindFirst.mockResolvedValue(null);
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: daysAgo(3),
    });
    expect(result.ok).toBe(true);
  });

  it("allows active student on last day of grace period (7 days past expiry, 7-day grace)", async () => {
    // Exactly at the grace boundary — should still be allowed.
    // Using 6.9 days to ensure we're within the period.
    const expiredAt = new Date(Date.now() - 6.9 * 86_400_000);
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: expiredAt,
    });
    expect(result.ok).toBe(true);
  });

  it("allows active student in grace period when BillingConfig provides custom grace days", async () => {
    mockFindFirst.mockResolvedValue({ gracePeriodDays: 14, cycleDays: 30, renewalWindowDays: 7 });
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: daysAgo(10), // within 14-day grace
    });
    expect(result.ok).toBe(true);
  });

  // ── Hard lock ───────────────────────────────────────────────────────────

  it("blocks active student past hard lock (8 days past expiry, 7-day grace)", async () => {
    mockFindFirst.mockResolvedValue(null); // gracePeriodDays = 7
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: daysAgo(8),
    });
    expect(result.ok).toBe(false);
  });

  it("returns 402 when hard-locked", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: daysAgo(8),
    });
    if (result.ok) throw new Error("Expected failure");
    expect(result.response.status).toBe(402);
    const body = await result.response.json();
    expect(body.error).toBe(
      "Your subscription has expired. Please renew to continue submitting work."
    );
  });

  it("blocks hard-locked student even with custom short grace period", async () => {
    mockFindFirst.mockResolvedValue({ gracePeriodDays: 2, cycleDays: 30, renewalWindowDays: 7 });
    const result = await checkSubscriptionAccess({
      status: "active",
      subscriptionExpiresAt: daysAgo(3), // 3 days past expiry, only 2-day grace
    });
    expect(result.ok).toBe(false);
  });

  it("does not block pre-active student even if their subscription is hard-locked", async () => {
    // Verify all pre-active statuses bypass billing entirely.
    const statuses = [
      "assessment_required",
      "pending_level_review",
      "approved_pending_login",
    ] as const;

    for (const status of statuses) {
      const result = await checkSubscriptionAccess({
        status,
        subscriptionExpiresAt: daysAgo(90),
      });
      expect(result.ok).toBe(true);
    }
    // BillingConfig must never be fetched for pre-active students.
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
