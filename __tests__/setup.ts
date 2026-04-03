// __tests__/setup.ts
// Global test setup — mocks that must be in place before any module import.

// Mock next/headers so route handlers don't crash when cookies() is called.
// Each test configures the returned get() mock to control which tokens are present.
jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

// Mock the rate limiter — always allow in tests so limits don't interfere.
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true }),
  getClientIp: jest.fn().mockReturnValue("127.0.0.1"),
  RATE_LIMITS: { presign: {} },
}));
