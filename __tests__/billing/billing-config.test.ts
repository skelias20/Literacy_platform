// __tests__/billing/billing-config.test.ts
// Section 5 — Billing Config GET/PUT

import { withAdminCookie, withNoCookies, withStudentCookie } from "../helpers/mocks";
import { makeRequest } from "../helpers/mocks";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const prismaMock = {
  billingConfig: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

jest.mock("@/lib/auth", () => ({
  verifyAdminJwt: jest.fn().mockReturnValue({ adminId: "admin-1" }),
  verifyStudentJwt: jest.fn().mockImplementation(() => {
    throw new Error("invalid role");
  }),
}));

import { GET, PUT } from "@/app/api/admin/billing-config/route";

const validBody = {
  cycleDays: 30,
  gracePeriodDays: 7,
  renewalWindowDays: 7,
  monthlyFee: 25.0,
  currency: "USD",
};

const existingConfig = {
  id: "config-1",
  cycleDays: 30,
  gracePeriodDays: 7,
  renewalWindowDays: 7,
  monthlyFee: { toString: () => "25.00" },
  currency: "USD",
  updatedByAdminId: "admin-1",
  updatedAt: new Date(),
  createdAt: new Date(),
};

describe("GET /api/admin/billing-config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withAdminCookie();
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 with no cookie", async () => {
    withNoCookies();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 401 with student cookie (admin-only route)", async () => {
    // Admin routes check for admin_token cookie first. When only student_token
    // is present, the route returns 401 before ever calling verifyAdminJwt.
    withStudentCookie();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  // ── No config row ─────────────────────────────────────────────────────────

  it("returns defaults with exists: false when no config row exists", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(false);
    expect(body.config.cycleDays).toBe(30);
    expect(body.config.gracePeriodDays).toBe(7);
    expect(body.config.renewalWindowDays).toBe(7);
    expect(body.config.monthlyFee).toBeNull();
    expect(body.config.currency).toBe("USD");
  });

  // ── Existing config row ───────────────────────────────────────────────────

  it("returns config data with exists: true when a row exists", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(existingConfig);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(true);
    expect(body.config.cycleDays).toBe(30);
  });

  it("serializes monthlyFee as a string (not a Decimal object)", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(existingConfig);
    const res = await GET();
    const body = await res.json();
    // Must be a string (Decimal serialized) — not an object
    expect(typeof body.config.monthlyFee).toBe("string");
    expect(body.config.monthlyFee).toBe("25.00");
  });

  it("returns monthlyFee: null when config has no fee set", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue({
      ...existingConfig,
      monthlyFee: null,
    });
    const res = await GET();
    const body = await res.json();
    expect(body.config.monthlyFee).toBeNull();
  });
});

describe("PUT /api/admin/billing-config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withAdminCookie();
    prismaMock.billingConfig.create.mockResolvedValue({});
    prismaMock.billingConfig.update.mockResolvedValue({});
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 with no cookie", async () => {
    withNoCookies();
    const res = await PUT(makeRequest("/api/admin/billing-config", { method: "PUT", body: validBody }));
    expect(res.status).toBe(401);
  });

  // ── Creates when no row exists ────────────────────────────────────────────

  it("creates a config row when none exists", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(null);
    const res = await PUT(makeRequest("/api/admin/billing-config", { method: "PUT", body: validBody }));
    expect(res.status).toBe(200);
    expect(prismaMock.billingConfig.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.billingConfig.update).not.toHaveBeenCalled();
  });

  it("does not create a second row when one already exists (upsert)", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(existingConfig);
    const res = await PUT(makeRequest("/api/admin/billing-config", { method: "PUT", body: validBody }));
    expect(res.status).toBe(200);
    expect(prismaMock.billingConfig.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.billingConfig.create).not.toHaveBeenCalled();
  });

  // ── monthlyFee handling ───────────────────────────────────────────────────

  it("accepts monthlyFee: null and stores null", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(null);
    const body = { ...validBody, monthlyFee: null };
    const res = await PUT(makeRequest("/api/admin/billing-config", { method: "PUT", body }));
    expect(res.status).toBe(200);
    const createData = prismaMock.billingConfig.create.mock.calls[0][0].data;
    expect(createData.monthlyFee).toBeNull();
  });

  it("accepts monthlyFee omitted (defaults to null)", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(null);
    const { monthlyFee: _unused, ...bodyNoFee } = validBody;
    const res = await PUT(makeRequest("/api/admin/billing-config", { method: "PUT", body: bodyNoFee }));
    expect(res.status).toBe(200);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("returns 400 for invalid cycleDays (0)", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(null);
    const res = await PUT(
      makeRequest("/api/admin/billing-config", {
        method: "PUT",
        body: { ...validBody, cycleDays: 0 },
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 for valid body", async () => {
    prismaMock.billingConfig.findFirst.mockResolvedValue(null);
    const res = await PUT(makeRequest("/api/admin/billing-config", { method: "PUT", body: validBody }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
