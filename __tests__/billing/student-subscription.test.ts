// __tests__/billing/student-subscription.test.ts
// Section 7 — Student Subscription GET
// GET /api/student/subscription

import { withStudentCookie, withNoCookies, daysFromNow, daysAgo } from "../helpers/mocks";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const prismaMock = {
  child: { findUnique: jest.fn() },
  billingConfig: { findFirst: jest.fn() },
  renewalPayment: { findFirst: jest.fn() },
};

jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

jest.mock("@/lib/auth", () => ({
  verifyStudentJwt: jest.fn().mockReturnValue({ childId: "child-1" }),
  verifyAdminJwt: jest.fn(),
}));

import { GET } from "@/app/api/student/subscription/route";

const CHILD_ID = "child-1";

async function callGet() {
  return GET();
}

describe("GET /api/student/subscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withStudentCookie();
    prismaMock.billingConfig.findFirst.mockResolvedValue(null); // default config
    prismaMock.renewalPayment.findFirst.mockResolvedValue(null); // no pending renewal
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 with no cookie", async () => {
    withNoCookies();
    const res = await callGet();
    expect(res.status).toBe(401);
  });

  it("returns 401 when child not found in DB", async () => {
    prismaMock.child.findUnique.mockResolvedValue(null);
    const res = await callGet();
    expect(res.status).toBe(401);
  });

  // ── Grandfathered ─────────────────────────────────────────────────────────

  it("returns accessState: grandfathered when subscriptionExpiresAt is null", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: null,
      status: "active",
    });
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessState).toBe("grandfathered");
    expect(body.subscriptionExpiresAt).toBeNull();
    expect(body.daysRemaining).toBeNull();
  });

  // ── Active subscription ───────────────────────────────────────────────────

  it("returns accessState: active when subscription has not expired", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysFromNow(15),
      status: "active",
    });
    const res = await callGet();
    const body = await res.json();
    expect(body.accessState).toBe("active");
  });

  it("returns positive daysRemaining for active subscriptions", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysFromNow(15),
      status: "active",
    });
    const res = await callGet();
    const body = await res.json();
    expect(body.daysRemaining).toBeGreaterThan(0);
    expect(body.daysRemaining).toBeLessThanOrEqual(15);
  });

  it("returns subscriptionExpiresAt as ISO string", async () => {
    const expiry = daysFromNow(15);
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: expiry,
      status: "active",
    });
    const res = await callGet();
    const body = await res.json();
    expect(body.subscriptionExpiresAt).toBe(expiry.toISOString());
  });

  // ── Grace period ──────────────────────────────────────────────────────────

  it("returns accessState: grace when expired within gracePeriodDays", async () => {
    // Expired 3 days ago, 7-day grace default = still in grace
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysAgo(3),
      status: "active",
    });
    const res = await callGet();
    const body = await res.json();
    expect(body.accessState).toBe("grace");
  });

  // ── Locked ────────────────────────────────────────────────────────────────

  it("returns accessState: locked when past gracePeriodDays", async () => {
    // Expired 8 days ago, 7-day grace default = hard locked
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysAgo(8),
      status: "active",
    });
    const res = await callGet();
    const body = await res.json();
    expect(body.accessState).toBe("locked");
  });

  it("uses custom gracePeriodDays from BillingConfig", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue({
      gracePeriodDays: 3,
      renewalWindowDays: 7,
      monthlyFee: null,
      currency: "USD",
    });
    // Expired 4 days ago, 3-day grace = locked
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysAgo(4),
      status: "active",
    });
    const res = await callGet();
    const body = await res.json();
    expect(body.accessState).toBe("locked");
  });

  // ── Pending renewal ───────────────────────────────────────────────────────

  it("includes pendingRenewal when one exists", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysFromNow(15),
      status: "active",
    });
    const pendingRenewal = {
      id: "renewal-1",
      createdAt: new Date("2026-04-01"),
    };
    prismaMock.renewalPayment.findFirst.mockResolvedValue(pendingRenewal);
    const res = await callGet();
    const body = await res.json();
    expect(body.pendingRenewal).not.toBeNull();
    expect(body.pendingRenewal.id).toBe("renewal-1");
    expect(body.pendingRenewal.submittedAt).toBe(pendingRenewal.createdAt.toISOString());
  });

  it("returns pendingRenewal: null when no pending renewal exists", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysFromNow(15),
      status: "active",
    });
    prismaMock.renewalPayment.findFirst.mockResolvedValue(null);
    const res = await callGet();
    const body = await res.json();
    expect(body.pendingRenewal).toBeNull();
  });

  // ── Fee and config fields ─────────────────────────────────────────────────

  it("returns monthlyFee: null when no BillingConfig", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysFromNow(10),
      status: "active",
    });
    prismaMock.billingConfig.findFirst.mockResolvedValue(null);
    const res = await callGet();
    const body = await res.json();
    expect(body.monthlyFee).toBeNull();
  });

  it("serializes monthlyFee as string from BillingConfig Decimal", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysFromNow(10),
      status: "active",
    });
    prismaMock.billingConfig.findFirst.mockResolvedValue({
      gracePeriodDays: 7,
      renewalWindowDays: 7,
      monthlyFee: { toString: () => "29.99" },
      currency: "USD",
    });
    const res = await callGet();
    const body = await res.json();
    expect(body.monthlyFee).toBe("29.99");
  });

  it("returns gracePeriodDays and renewalWindowDays in response", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      subscriptionExpiresAt: daysFromNow(10),
      status: "active",
    });
    const res = await callGet();
    const body = await res.json();
    expect(body.gracePeriodDays).toBeDefined();
    expect(body.renewalWindowDays).toBeDefined();
  });
});
