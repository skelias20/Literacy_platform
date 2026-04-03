// __tests__/billing/renewal-approve.test.ts
// Section 3 — Renewal Approval
// Core billing logic: periodStart must be current periodEnd, not now().

import { withAdminCookie, withNoCookies, enableTransaction, daysFromNow, daysAgo } from "../helpers/mocks";
import { makeRequest } from "../helpers/mocks";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

// ── Prisma mock ──────────────────────────────────────────────────────────────
const prismaMock = {
  renewalPayment: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  subscription: { create: jest.fn() },
  child: { update: jest.fn() },
  adminAuditLog: { create: jest.fn() },
  paymentEvent: { create: jest.fn() },
  billingConfig: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

jest.mock("@/lib/auth", () => ({
  verifyAdminJwt: jest.fn().mockReturnValue({ adminId: "admin-1" }),
  verifyStudentJwt: jest.fn(),
}));

import { POST } from "@/app/api/admin/subscriptions/[id]/approve/route";

const CHILD_ID = "child-1";
const RENEWAL_ID = "renewal-1";
const CURRENT_EXPIRY = daysFromNow(5); // subscription active, 5 days left

const pendingRenewal = {
  id: RENEWAL_ID,
  childId: CHILD_ID,
  status: "pending",
  method: "transaction_id",
  transactionId: "TX-456",
  child: {
    subscriptionExpiresAt: CURRENT_EXPIRY,
  },
};

async function callApprove(id = RENEWAL_ID) {
  return POST(makeRequest(`/api/admin/subscriptions/${id}/approve`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/admin/subscriptions/[id]/approve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withAdminCookie();
    enableTransaction(prismaMock);
    prismaMock.renewalPayment.findUnique.mockResolvedValue(pendingRenewal);
    prismaMock.billingConfig.findFirst.mockResolvedValue(null); // 30-day fallback
    prismaMock.renewalPayment.update.mockResolvedValue({});
    prismaMock.subscription.create.mockResolvedValue({});
    prismaMock.child.update.mockResolvedValue({});
    prismaMock.adminAuditLog.create.mockResolvedValue({});
    prismaMock.paymentEvent.create.mockResolvedValue({});
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 with no auth", async () => {
    withNoCookies();
    const res = await callApprove();
    expect(res.status).toBe(401);
  });

  // ── Not found / status guards ─────────────────────────────────────────────

  it("returns 404 for unknown renewal ID", async () => {
    prismaMock.renewalPayment.findUnique.mockResolvedValue(null);
    const res = await callApprove();
    expect(res.status).toBe(404);
  });

  it("returns 400 when renewal is already approved (idempotency guard)", async () => {
    prismaMock.renewalPayment.findUnique.mockResolvedValue({
      ...pendingRenewal,
      status: "approved",
    });
    const res = await callApprove();
    expect(res.status).toBe(400);
  });

  it("returns 400 when renewal is already rejected", async () => {
    prismaMock.renewalPayment.findUnique.mockResolvedValue({
      ...pendingRenewal,
      status: "rejected",
    });
    const res = await callApprove();
    expect(res.status).toBe(400);
  });

  it("does not create a duplicate Subscription row on double-approve", async () => {
    prismaMock.renewalPayment.findUnique
      .mockResolvedValueOnce(pendingRenewal)
      .mockResolvedValueOnce({ ...pendingRenewal, status: "approved" });

    await callApprove();
    const res = await callApprove();
    expect(res.status).toBe(400);
    expect(prismaMock.subscription.create).toHaveBeenCalledTimes(1);
  });

  // ── Happy path — core periodStart logic ───────────────────────────────────

  it("returns 200 on successful approval", async () => {
    const res = await callApprove();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("sets periodStart = child.subscriptionExpiresAt (not now)", async () => {
    await callApprove();
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    // periodStart must equal the child's current expiry — not today's date.
    expect(subCall.data.periodStart.getTime()).toBe(CURRENT_EXPIRY.getTime());
  });

  it("sets periodEnd = periodStart + cycleDays (30-day fallback)", async () => {
    await callApprove();
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    const diffDays = (subCall.data.periodEnd - subCall.data.periodStart) / 86_400_000;
    expect(diffDays).toBeCloseTo(30, 0);
  });

  it("uses BillingConfig.cycleDays when config exists", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue({ cycleDays: 45 });
    await callApprove();
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    const diffDays = (subCall.data.periodEnd - subCall.data.periodStart) / 86_400_000;
    expect(diffDays).toBeCloseTo(45, 0);
  });

  it("links the Subscription row to the renewalPaymentId", async () => {
    await callApprove();
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    expect(subCall.data.renewalPaymentId).toBe(RENEWAL_ID);
    expect(subCall.data.childId).toBe(CHILD_ID);
  });

  it("updates Child.subscriptionExpiresAt to the new periodEnd", async () => {
    await callApprove();
    const subCall  = prismaMock.subscription.create.mock.calls[0][0];
    const childCall = prismaMock.child.update.mock.calls[0][0];
    expect(childCall.data.subscriptionExpiresAt).toEqual(subCall.data.periodEnd);
  });

  // ── Grandfathered edge case (null subscriptionExpiresAt) ─────────────────

  it("uses now() as periodStart when child.subscriptionExpiresAt is null (grandfathered)", async () => {
    prismaMock.renewalPayment.findUnique.mockResolvedValue({
      ...pendingRenewal,
      child: { subscriptionExpiresAt: null },
    });
    const before = new Date();
    await callApprove();
    const after = new Date();
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    // periodStart should be approximately now()
    expect(subCall.data.periodStart.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(subCall.data.periodStart.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  // ── Audit trail ───────────────────────────────────────────────────────────

  it("writes RENEWAL_APPROVED to AdminAuditLog", async () => {
    await callApprove();
    const auditCall = prismaMock.adminAuditLog.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("RENEWAL_APPROVED");
    expect(auditCall.data.adminId).toBe("admin-1");
    expect(auditCall.data.targetChildId).toBe(CHILD_ID);
    expect(auditCall.data.metadata.renewalPaymentId).toBe(RENEWAL_ID);
  });

  it("writes RENEWAL_APPROVED to PaymentEvent", async () => {
    await callApprove();
    const eventCall = prismaMock.paymentEvent.create.mock.calls[0][0];
    expect(eventCall.data.eventType).toBe("RENEWAL_APPROVED");
    expect(eventCall.data.renewalPaymentId).toBe(RENEWAL_ID);
    expect(eventCall.data.childId).toBe(CHILD_ID);
    expect(eventCall.data.adminId).toBe("admin-1");
  });

  it("marks RenewalPayment as approved with reviewedByAdminId and reviewedAt", async () => {
    const before = new Date();
    await callApprove();
    const after = new Date();
    const updateCall = prismaMock.renewalPayment.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("approved");
    expect(updateCall.data.reviewedByAdminId).toBe("admin-1");
    expect(updateCall.data.reviewedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updateCall.data.reviewedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
