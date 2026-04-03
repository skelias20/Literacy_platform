// __tests__/billing/student-renewal.test.ts
// Section 8 — Student Renewal POST
// POST /api/student/subscription/renew

import {
  withStudentCookie,
  withNoCookies,
  withAdminCookie,
  enableTransaction,
} from "../helpers/mocks";
import { makeRequest } from "../helpers/mocks";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const prismaMock = {
  child: { findUnique: jest.fn() },
  renewalPayment: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  file: { findUnique: jest.fn() },
  paymentEvent: { create: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

jest.mock("@/lib/auth", () => ({
  verifyStudentJwt: jest.fn().mockReturnValue({ childId: "child-1" }),
  verifyAdminJwt: jest.fn().mockImplementation(() => {
    throw new Error("invalid role");
  }),
}));

import { POST } from "@/app/api/student/subscription/renew/route";

const CHILD_ID = "child-1";
const FILE_ID = "file-1";

const activeChild = { id: CHILD_ID, status: "active" };

async function callRenew(body: Record<string, unknown>) {
  return POST(
    makeRequest("/api/student/subscription/renew", { method: "POST", body })
  );
}

describe("POST /api/student/subscription/renew", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withStudentCookie();
    enableTransaction(prismaMock);
    prismaMock.child.findUnique.mockResolvedValue(activeChild);
    prismaMock.renewalPayment.findFirst.mockResolvedValue(null); // no pending renewal
    prismaMock.renewalPayment.create.mockResolvedValue({ id: "renewal-1" });
    prismaMock.paymentEvent.create.mockResolvedValue({});
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 with no cookie", async () => {
    withNoCookies();
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    expect(res.status).toBe(401);
  });

  // ── Status blocks ─────────────────────────────────────────────────────────

  it("returns 403 when student is pending_payment", async () => {
    prismaMock.child.findUnique.mockResolvedValue({ id: CHILD_ID, status: "pending_payment" });
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when student is rejected", async () => {
    prismaMock.child.findUnique.mockResolvedValue({ id: CHILD_ID, status: "rejected" });
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    expect(res.status).toBe(403);
  });

  it("allows renewal for approved_pending_login students", async () => {
    prismaMock.child.findUnique.mockResolvedValue({ id: CHILD_ID, status: "approved_pending_login" });
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    expect(res.status).toBe(200);
  });

  it("allows renewal for assessment_required students", async () => {
    prismaMock.child.findUnique.mockResolvedValue({ id: CHILD_ID, status: "assessment_required" });
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    expect(res.status).toBe(200);
  });

  it("allows renewal for pending_level_review students", async () => {
    prismaMock.child.findUnique.mockResolvedValue({ id: CHILD_ID, status: "pending_level_review" });
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    expect(res.status).toBe(200);
  });

  // ── Duplicate pending guard ───────────────────────────────────────────────

  it("returns 409 when a pending renewal already exists", async () => {
    prismaMock.renewalPayment.findFirst.mockResolvedValue({ id: "existing-renewal" });
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    expect(res.status).toBe(409);
  });

  it("allows a second renewal after the first is rejected (no pending block)", async () => {
    // After rejection, findFirst returns null (no pending) → should succeed
    prismaMock.renewalPayment.findFirst.mockResolvedValue(null);
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-2" });
    expect(res.status).toBe(200);
  });

  // ── receipt_upload validation ─────────────────────────────────────────────

  it("returns 400 for receipt_upload method with no receiptFileId", async () => {
    const res = await callRenew({ method: "receipt_upload" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when receiptFileId points to non-existent file", async () => {
    prismaMock.file.findUnique.mockResolvedValue(null);
    const res = await callRenew({ method: "receipt_upload", receiptFileId: FILE_ID });
    expect(res.status).toBe(400);
  });

  it("returns 400 when receipt file uploadStatus is PENDING", async () => {
    prismaMock.file.findUnique.mockResolvedValue({ id: FILE_ID, uploadStatus: "PENDING" });
    const res = await callRenew({ method: "receipt_upload", receiptFileId: FILE_ID });
    expect(res.status).toBe(400);
  });

  it("returns 400 when receipt file uploadStatus is FAILED", async () => {
    prismaMock.file.findUnique.mockResolvedValue({ id: FILE_ID, uploadStatus: "FAILED" });
    const res = await callRenew({ method: "receipt_upload", receiptFileId: FILE_ID });
    expect(res.status).toBe(400);
  });

  it("succeeds for receipt_upload with COMPLETED file", async () => {
    prismaMock.file.findUnique.mockResolvedValue({ id: FILE_ID, uploadStatus: "COMPLETED" });
    const res = await callRenew({ method: "receipt_upload", receiptFileId: FILE_ID });
    expect(res.status).toBe(200);
  });

  // ── transaction_id validation ─────────────────────────────────────────────

  it("returns 400 for transaction_id method with no transactionId", async () => {
    const res = await callRenew({ method: "transaction_id" });
    expect(res.status).toBe(400);
  });

  it("succeeds for transaction_id method with a transactionId", async () => {
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-VALID-123" });
    expect(res.status).toBe(200);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("creates RenewalPayment with pending status", async () => {
    await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    const createCall = prismaMock.renewalPayment.create.mock.calls[0][0];
    expect(createCall.data.status).toBe("pending");
    expect(createCall.data.childId).toBe(CHILD_ID);
    expect(createCall.data.method).toBe("transaction_id");
    expect(createCall.data.transactionId).toBe("TX-1");
  });

  it("writes RENEWAL_SUBMITTED PaymentEvent", async () => {
    await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    const eventCall = prismaMock.paymentEvent.create.mock.calls[0][0];
    expect(eventCall.data.eventType).toBe("RENEWAL_SUBMITTED");
    expect(eventCall.data.childId).toBe(CHILD_ID);
    expect(eventCall.data.renewalPaymentId).toBe("renewal-1");
  });

  it("returns the renewalPaymentId in the response", async () => {
    const res = await callRenew({ method: "transaction_id", transactionId: "TX-1" });
    const body = await res.json();
    expect(body.renewalPaymentId).toBe("renewal-1");
    expect(body.ok).toBe(true);
  });

  // ── receipt_upload: links receiptFileId ───────────────────────────────────

  it("links receiptFileId on renewal when receipt_upload method is used", async () => {
    prismaMock.file.findUnique.mockResolvedValue({ id: FILE_ID, uploadStatus: "COMPLETED" });
    await callRenew({ method: "receipt_upload", receiptFileId: FILE_ID });
    const createCall = prismaMock.renewalPayment.create.mock.calls[0][0];
    expect(createCall.data.receiptFileId).toBe(FILE_ID);
    expect(createCall.data.transactionId).toBeNull();
  });
});
