// __tests__/billing/upload-presign-renewal.test.ts
// Section 10 — Upload: renewal_receipt context
// Security boundary between authenticated student / unauthenticated / admin token.

import {
  withStudentCookie,
  withAdminCookie,
  withNoCookies,
} from "../helpers/mocks";
import { makeRequest } from "../helpers/mocks";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true }),
  getClientIp: jest.fn().mockReturnValue("127.0.0.1"),
  RATE_LIMITS: { presign: {} },
}));

// ── Prisma mock ──────────────────────────────────────────────────────────────
const prismaMock = {
  assessment: { findUnique: jest.fn() },
  dailyTask: { findUnique: jest.fn() },
  dailySubmission: { findUnique: jest.fn() },
  child: { findUnique: jest.fn() },
  file: { create: jest.fn() },
};

jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// ── R2 mock ──────────────────────────────────────────────────────────────────
jest.mock("@/lib/r2", () => ({
  generateFileId: jest.fn().mockReturnValue("file-id-123"),
  generatePresignedPutUrl: jest.fn().mockResolvedValue("https://r2.example.com/presigned"),
  generateR2Key: jest.fn().mockReturnValue("renewals/child-1/file-id-123.jpg"),
  validateUpload: jest.fn().mockReturnValue({ ok: true }),
}));

jest.mock("@/lib/auth", () => ({
  verifyStudentJwt: jest.fn().mockReturnValue({ childId: "child-1" }),
  verifyAdminJwt: jest.fn().mockReturnValue({ adminId: "admin-1" }),
}));

import { POST } from "@/app/api/upload/presign/route";

const validRenewalBody = {
  context: "renewal_receipt",
  mimeType: "image/jpeg",
  byteSize: 512000,
  originalName: "receipt.jpg",
};

const validReceiptBody = {
  context: "receipt",
  mimeType: "image/jpeg",
  byteSize: 512000,
  originalName: "registration-receipt.jpg",
};

async function callPresign(body: Record<string, unknown>) {
  return POST(makeRequest("/api/upload/presign", { method: "POST", body }));
}

// Helper: reset auth mocks to defaults after each test.
function resetAuthMocks() {
  const { verifyStudentJwt, verifyAdminJwt } = require("@/lib/auth");
  (verifyStudentJwt as jest.Mock).mockReturnValue({ childId: "child-1" });
  (verifyAdminJwt as jest.Mock).mockReturnValue({ adminId: "admin-1" });
}

describe("POST /api/upload/presign — renewal_receipt context", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAuthMocks();
    prismaMock.file.create.mockResolvedValue({});
  });

  // ── Auth: renewal_receipt requires student token ──────────────────────────

  it("returns 401 when unauthenticated (no cookie)", async () => {
    withNoCookies();
    const res = await callPresign(validRenewalBody);
    expect(res.status).toBe(401);
  });

  it("returns 403 when only admin token is present (renewal_receipt requires student)", async () => {
    // Admin has admin_token but no student_token.
    // The presign route tries student first for renewal_receipt, fails (no student_token),
    // then falls back to admin token → uploaderType = "admin" → role check rejects with 403.
    withAdminCookie();
    const res = await callPresign(validRenewalBody);
    expect(res.status).toBe(403);
  });

  it("succeeds (200) when authenticated student requests renewal_receipt presign", async () => {
    withStudentCookie();
    const res = await callPresign(validRenewalBody);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presignedUrl).toBeDefined();
    expect(body.fileId).toBeDefined();
  });

  it("returns presignedUrl and fileId in response", async () => {
    withStudentCookie();
    const res = await callPresign(validRenewalBody);
    const body = await res.json();
    expect(body.presignedUrl).toBe("https://r2.example.com/presigned");
    expect(body.fileId).toBe("file-id-123");
  });

  it("creates a PENDING File row with uploadedByChildId set", async () => {
    withStudentCookie();
    await callPresign(validRenewalBody);
    const createCall = prismaMock.file.create.mock.calls[0][0];
    expect(createCall.data.uploadStatus).toBe("PENDING");
    expect(createCall.data.uploadedByChildId).toBe("child-1");
    expect(createCall.data.uploadedByAdminId).toBeNull();
  });

  // ── receipt context: unauthenticated allowed ──────────────────────────────

  it("allows unauthenticated presign for receipt context (registration flow unaffected)", async () => {
    withNoCookies();
    const res = await callPresign(validReceiptBody);
    expect(res.status).toBe(200);
  });

  // ── admin_content: requires admin token ───────────────────────────────────

  it("returns 403 when student tries to presign admin_content", async () => {
    // student_token present, no admin_token → uploaderType = "student" → role check: 403
    withStudentCookie();
    const res = await callPresign({ ...validRenewalBody, context: "admin_content" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/upload/presign — regression: existing contexts unaffected", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAuthMocks();
    prismaMock.file.create.mockResolvedValue({});
  });

  it("receipt context still works unauthenticated after renewal_receipt auth change", async () => {
    withNoCookies();
    const res = await callPresign(validReceiptBody);
    expect(res.status).toBe(200);
  });

  it("assessment_audio requires student token", async () => {
    withStudentCookie();
    prismaMock.assessment.findUnique.mockResolvedValue({
      childId: "child-1",
      submittedAt: null,
    });
    const res = await callPresign({
      context: "assessment_audio",
      mimeType: "audio/webm",
      byteSize: 102400,
      originalName: "speaking.webm",
      assessmentId: "assessment-1",
      skill: "speaking",
    });
    expect(res.status).toBe(200);
  });

  it("assessment_audio returns 401 when unauthenticated", async () => {
    withNoCookies();
    const res = await callPresign({
      context: "assessment_audio",
      mimeType: "audio/webm",
      byteSize: 102400,
      originalName: "speaking.webm",
      assessmentId: "assessment-1",
      skill: "speaking",
    });
    expect(res.status).toBe(401);
  });
});
