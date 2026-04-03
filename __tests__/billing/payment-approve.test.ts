// __tests__/billing/payment-approve.test.ts
// Section 2 — Payment Approve → First Subscription
// Also covers Section 12 regressions: state machine unchanged, status set correctly.

import { withAdminCookie, withNoCookies, enableTransaction, daysFromNow } from "../helpers/mocks";
import { makeRequest } from "../helpers/mocks";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

// ── Prisma mock ──────────────────────────────────────────────────────────────
const prismaMock = {
  payment: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  child: { update: jest.fn() },
  subscription: { create: jest.fn() },
  adminAuditLog: { create: jest.fn() },
  paymentEvent: { create: jest.fn() },
  billingConfig: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// ── Auth mock ────────────────────────────────────────────────────────────────
jest.mock("@/lib/auth", () => ({
  verifyAdminJwt: jest.fn().mockReturnValue({ adminId: "admin-1" }),
  verifyStudentJwt: jest.fn().mockReturnValue({ childId: "child-1" }),
}));

import { POST } from "@/app/api/admin/payments/[id]/approve/route";

const CHILD_ID = "child-1";
const PAYMENT_ID = "payment-1";

const pendingPayment = {
  id: PAYMENT_ID,
  childId: CHILD_ID,
  status: "pending",
  method: "transaction_id",
  transactionId: "TX-123",
  child: {
    id: CHILD_ID,
    status: "pending_payment",
  },
};

async function callApprove(id = PAYMENT_ID) {
  return POST(makeRequest(`/api/admin/payments/${id}/approve`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/admin/payments/[id]/approve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withAdminCookie();
    enableTransaction(prismaMock);
    prismaMock.payment.findUnique.mockResolvedValue(pendingPayment);
    prismaMock.billingConfig.findFirst.mockResolvedValue(null); // no config = 30-day fallback
    prismaMock.payment.update.mockResolvedValue({});
    prismaMock.child.update.mockResolvedValue({});
    prismaMock.subscription.create.mockResolvedValue({});
    prismaMock.adminAuditLog.create.mockResolvedValue({});
    prismaMock.paymentEvent.create.mockResolvedValue({});
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 with no cookie", async () => {
    withNoCookies();
    const res = await callApprove();
    expect(res.status).toBe(401);
  });

  // ── Not found ─────────────────────────────────────────────────────────────

  it("returns 404 when payment does not exist", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);
    const res = await callApprove();
    expect(res.status).toBe(404);
  });

  // ── Already reviewed guard ────────────────────────────────────────────────

  it("returns 400 when payment is already approved", async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ ...pendingPayment, status: "approved" });
    const res = await callApprove();
    expect(res.status).toBe(400);
  });

  it("returns 400 when payment is already rejected", async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ ...pendingPayment, status: "rejected" });
    const res = await callApprove();
    expect(res.status).toBe(400);
  });

  it("does not create a second Subscription row on double-approve", async () => {
    // First call succeeds (pending → approved); second call sees approved and returns 400.
    prismaMock.payment.findUnique
      .mockResolvedValueOnce(pendingPayment)
      .mockResolvedValueOnce({ ...pendingPayment, status: "approved" });

    await callApprove(); // first approve succeeds
    const res = await callApprove(); // second attempt
    expect(res.status).toBe(400);
    expect(prismaMock.subscription.create).toHaveBeenCalledTimes(1);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns 200 on successful approval", async () => {
    const res = await callApprove();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("sets child status to approved_pending_login (state machine)", async () => {
    await callApprove();
    const childUpdateCall = prismaMock.child.update.mock.calls[0][0];
    expect(childUpdateCall.data.status).toBe("approved_pending_login");
  });

  it("creates exactly one Subscription row with renewalPaymentId = null", async () => {
    await callApprove();
    expect(prismaMock.subscription.create).toHaveBeenCalledTimes(1);
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    expect(subCall.data.renewalPaymentId).toBeUndefined(); // null on creation means field absent or null
    expect(subCall.data.childId).toBe(CHILD_ID);
  });

  it("sets periodEnd approximately cycleDays (30) days from now when no BillingConfig", async () => {
    await callApprove();
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    const { periodStart, periodEnd } = subCall.data;
    const diffMs = periodEnd.getTime() - periodStart.getTime();
    const diffDays = diffMs / 86_400_000;
    expect(diffDays).toBeCloseTo(30, 0);
  });

  it("uses BillingConfig.cycleDays when a config row exists", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue({
      cycleDays: 60,
      gracePeriodDays: 7,
      renewalWindowDays: 7,
    });
    await callApprove();
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    const diffDays = (subCall.data.periodEnd - subCall.data.periodStart) / 86_400_000;
    expect(diffDays).toBeCloseTo(60, 0);
  });

  it("updates Child.subscriptionExpiresAt to match periodEnd", async () => {
    await callApprove();
    const subCall = prismaMock.subscription.create.mock.calls[0][0];
    const childUpdateCall = prismaMock.child.update.mock.calls[0][0];
    expect(childUpdateCall.data.subscriptionExpiresAt).toEqual(subCall.data.periodEnd);
  });

  it("writes PAYMENT_APPROVED audit log", async () => {
    await callApprove();
    const auditCall = prismaMock.adminAuditLog.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("PAYMENT_APPROVED");
    expect(auditCall.data.adminId).toBe("admin-1");
    expect(auditCall.data.targetChildId).toBe(CHILD_ID);
  });

  it("writes PAYMENT_APPROVED PaymentEvent", async () => {
    await callApprove();
    const eventCall = prismaMock.paymentEvent.create.mock.calls[0][0];
    expect(eventCall.data.eventType).toBe("PAYMENT_APPROVED");
    expect(eventCall.data.childId).toBe(CHILD_ID);
    expect(eventCall.data.adminId).toBe("admin-1");
  });

  it("sets statusBefore = pending_payment and statusAfter = approved_pending_login in PaymentEvent", async () => {
    await callApprove();
    const eventCall = prismaMock.paymentEvent.create.mock.calls[0][0];
    expect(eventCall.data.statusBefore).toBe("pending_payment");
    expect(eventCall.data.statusAfter).toBe("approved_pending_login");
  });
});
