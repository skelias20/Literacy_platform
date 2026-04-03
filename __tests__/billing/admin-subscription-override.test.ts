// __tests__/billing/admin-subscription-override.test.ts
// Section 6 — Admin Subscription Override
// PATCH /api/admin/students/[childId]/subscription

import { withAdminCookie, withNoCookies, enableTransaction, daysFromNow } from "../helpers/mocks";
import { makeRequest } from "../helpers/mocks";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const prismaMock = {
  child: { findUnique: jest.fn(), update: jest.fn() },
  adminAuditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

jest.mock("@/lib/auth", () => ({
  verifyAdminJwt: jest.fn().mockReturnValue({ adminId: "admin-1" }),
  verifyStudentJwt: jest.fn(),
}));

import { PATCH } from "@/app/api/admin/students/[childId]/subscription/route";

const CHILD_ID = "child-1";
const FUTURE_DATE = daysFromNow(30);

async function callOverride(
  childId: string,
  body: Record<string, unknown>
) {
  return PATCH(
    makeRequest(`/api/admin/students/${childId}/subscription`, {
      method: "PATCH",
      body,
    }),
    { params: Promise.resolve({ childId }) }
  );
}

describe("PATCH /api/admin/students/[childId]/subscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withAdminCookie();
    enableTransaction(prismaMock);
    prismaMock.child.findUnique.mockResolvedValue({
      id: CHILD_ID,
      subscriptionExpiresAt: new Date("2026-03-01"),
    });
    prismaMock.child.update.mockResolvedValue({});
    prismaMock.adminAuditLog.create.mockResolvedValue({});
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 with no auth", async () => {
    withNoCookies();
    const res = await callOverride(CHILD_ID, {
      subscriptionExpiresAt: FUTURE_DATE.toISOString(),
    });
    expect(res.status).toBe(401);
  });

  // ── Not found ─────────────────────────────────────────────────────────────

  it("returns 404 for non-existent childId", async () => {
    prismaMock.child.findUnique.mockResolvedValue(null);
    const res = await callOverride("nonexistent", {
      subscriptionExpiresAt: FUTURE_DATE.toISOString(),
    });
    expect(res.status).toBe(404);
  });

  // ── Set future date ───────────────────────────────────────────────────────

  it("updates Child.subscriptionExpiresAt to the provided date", async () => {
    const newDate = daysFromNow(60).toISOString();
    await callOverride(CHILD_ID, { subscriptionExpiresAt: newDate });
    const updateCall = prismaMock.child.update.mock.calls[0][0];
    expect(updateCall.data.subscriptionExpiresAt).toEqual(new Date(newDate));
  });

  it("returns 200 on successful future-date override", async () => {
    const res = await callOverride(CHILD_ID, {
      subscriptionExpiresAt: FUTURE_DATE.toISOString(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // ── Set null (grandfather) ────────────────────────────────────────────────

  it("sets subscriptionExpiresAt to null when null is provided (grandfathering)", async () => {
    const res = await callOverride(CHILD_ID, { subscriptionExpiresAt: null });
    expect(res.status).toBe(200);
    const updateCall = prismaMock.child.update.mock.calls[0][0];
    expect(updateCall.data.subscriptionExpiresAt).toBeNull();
  });

  // ── Audit log ─────────────────────────────────────────────────────────────

  it("writes SUBSCRIPTION_OVERRIDDEN to AdminAuditLog", async () => {
    const newExpiry = FUTURE_DATE.toISOString();
    await callOverride(CHILD_ID, { subscriptionExpiresAt: newExpiry, reason: "Manual extension" });
    const auditCall = prismaMock.adminAuditLog.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("SUBSCRIPTION_OVERRIDDEN");
    expect(auditCall.data.adminId).toBe("admin-1");
    expect(auditCall.data.targetChildId).toBe(CHILD_ID);
  });

  it("includes previousExpiry and newExpiry in audit metadata", async () => {
    const newExpiry = FUTURE_DATE.toISOString();
    await callOverride(CHILD_ID, { subscriptionExpiresAt: newExpiry });
    const auditCall = prismaMock.adminAuditLog.create.mock.calls[0][0];
    const meta = auditCall.data.metadata;
    expect(meta.previousExpiry).toBe("2026-03-01T00:00:00.000Z");
    expect(meta.newExpiry).toBe(new Date(newExpiry).toISOString());
  });

  it("records null previousExpiry when child had no prior expiry", async () => {
    prismaMock.child.findUnique.mockResolvedValue({
      id: CHILD_ID,
      subscriptionExpiresAt: null,
    });
    await callOverride(CHILD_ID, { subscriptionExpiresAt: FUTURE_DATE.toISOString() });
    const meta = prismaMock.adminAuditLog.create.mock.calls[0][0].data.metadata;
    expect(meta.previousExpiry).toBeNull();
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("returns 400 for invalid datetime string", async () => {
    const res = await callOverride(CHILD_ID, {
      subscriptionExpiresAt: "not-a-date",
    });
    expect(res.status).toBe(400);
  });
});
