// __tests__/billing/renewal-reject.test.ts
// Section 4 — Renewal Rejection
// Rejection must not touch Subscription table or Child.subscriptionExpiresAt.

import { withAdminCookie, withNoCookies, enableTransaction, daysFromNow } from "../helpers/mocks";
import { makeRequest } from "../helpers/mocks";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const prismaMock = {
  renewalPayment: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  adminAuditLog: { create: jest.fn() },
  paymentEvent: { create: jest.fn() },
  subscription: { create: jest.fn() },
  child: { update: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

jest.mock("@/lib/auth", () => ({
  verifyAdminJwt: jest.fn().mockReturnValue({ adminId: "admin-1" }),
  verifyStudentJwt: jest.fn(),
}));

import { POST } from "@/app/api/admin/subscriptions/[id]/reject/route";

const CHILD_ID = "child-1";
const RENEWAL_ID = "renewal-1";

const pendingRenewal = {
  id: RENEWAL_ID,
  childId: CHILD_ID,
  status: "pending",
  method: "transaction_id",
  transactionId: "TX-789",
};

async function callReject(id = RENEWAL_ID, body: Record<string, unknown> = {}) {
  return POST(makeRequest(`/api/admin/subscriptions/${id}/reject`, { method: "POST", body }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/admin/subscriptions/[id]/reject", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withAdminCookie();
    enableTransaction(prismaMock);
    prismaMock.renewalPayment.findUnique.mockResolvedValue(pendingRenewal);
    prismaMock.renewalPayment.update.mockResolvedValue({});
    prismaMock.adminAuditLog.create.mockResolvedValue({});
    prismaMock.paymentEvent.create.mockResolvedValue({});
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 with no auth", async () => {
    withNoCookies();
    const res = await callReject();
    expect(res.status).toBe(401);
  });

  // ── Status guards ─────────────────────────────────────────────────────────

  it("returns 404 for unknown renewal ID", async () => {
    prismaMock.renewalPayment.findUnique.mockResolvedValue(null);
    const res = await callReject();
    expect(res.status).toBe(404);
  });

  it("returns 400 when trying to reject an already-approved renewal", async () => {
    prismaMock.renewalPayment.findUnique.mockResolvedValue({
      ...pendingRenewal,
      status: "approved",
    });
    const res = await callReject();
    expect(res.status).toBe(400);
  });

  it("returns 400 when trying to reject an already-rejected renewal", async () => {
    prismaMock.renewalPayment.findUnique.mockResolvedValue({
      ...pendingRenewal,
      status: "rejected",
    });
    const res = await callReject();
    expect(res.status).toBe(400);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns 200 on successful rejection", async () => {
    const res = await callReject();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("does NOT create any Subscription row on rejection", async () => {
    await callReject();
    expect(prismaMock.subscription.create).not.toHaveBeenCalled();
  });

  it("does NOT update Child.subscriptionExpiresAt on rejection", async () => {
    await callReject();
    expect(prismaMock.child.update).not.toHaveBeenCalled();
  });

  it("marks RenewalPayment as rejected with reviewer info", async () => {
    await callReject();
    const updateCall = prismaMock.renewalPayment.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("rejected");
    expect(updateCall.data.reviewedByAdminId).toBe("admin-1");
    expect(updateCall.data.reviewedAt).toBeInstanceOf(Date);
  });

  it("writes RENEWAL_REJECTED to AdminAuditLog", async () => {
    await callReject(RENEWAL_ID, { reason: "Payment unreadable" });
    const auditCall = prismaMock.adminAuditLog.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("RENEWAL_REJECTED");
    expect(auditCall.data.adminId).toBe("admin-1");
    expect(auditCall.data.targetChildId).toBe(CHILD_ID);
  });

  it("writes RENEWAL_REJECTED to PaymentEvent", async () => {
    await callReject();
    const eventCall = prismaMock.paymentEvent.create.mock.calls[0][0];
    expect(eventCall.data.eventType).toBe("RENEWAL_REJECTED");
    expect(eventCall.data.renewalPaymentId).toBe(RENEWAL_ID);
    expect(eventCall.data.childId).toBe(CHILD_ID);
  });

  it("includes rejection reason in PaymentEvent notes when provided", async () => {
    await callReject(RENEWAL_ID, { reason: "Blurry receipt" });
    const eventCall = prismaMock.paymentEvent.create.mock.calls[0][0];
    expect(eventCall.data.notes).toBe("Blurry receipt");
  });

  it("accepts rejection with empty body (reason optional)", async () => {
    const res = await callReject(RENEWAL_ID, {});
    expect(res.status).toBe(200);
  });
});
