// __tests__/helpers/mocks.ts
// Shared mock factories for Prisma, auth, and cookies.

// ---------------------------------------------------------------------------
// Cookie helpers
// Use dynamic require so the jest.mock() in each test file has already run
// by the time these functions are called, giving us the mock function.
// ---------------------------------------------------------------------------

export const ADMIN_TOKEN = "mock-admin-token";
export const STUDENT_TOKEN = "mock-student-token";

function getCookiesMock(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("next/headers").cookies as jest.Mock;
}

/** Configure the cookies() mock to return an admin_token. */
export function withAdminCookie(token = ADMIN_TOKEN) {
  getCookiesMock().mockResolvedValue({
    get: jest.fn((name: string) =>
      name === "admin_token" ? { value: token } : undefined
    ),
  });
}

/** Configure the cookies() mock to return a student_token. */
export function withStudentCookie(token = STUDENT_TOKEN) {
  getCookiesMock().mockResolvedValue({
    get: jest.fn((name: string) =>
      name === "student_token" ? { value: token } : undefined
    ),
  });
}

/** Configure the cookies() mock to return neither token (unauthenticated). */
export function withNoCookies() {
  getCookiesMock().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined),
  });
}

/** Configure the cookies() mock to have both tokens (admin + student logged in simultaneously — edge case). */
export function withBothCookies() {
  getCookiesMock().mockResolvedValue({
    get: jest.fn((name: string) => {
      if (name === "admin_token")   return { value: ADMIN_TOKEN };
      if (name === "student_token") return { value: STUDENT_TOKEN };
      return undefined;
    }),
  });
}

// ---------------------------------------------------------------------------
// Prisma transaction helper
// ---------------------------------------------------------------------------

/**
 * Wraps a Prisma mock so that $transaction(fn) just calls fn(prisma).
 * This lets the callback use the same mocked prisma client.
 */
export function enableTransaction(prismaMock: Record<string, unknown>) {
  (prismaMock.$transaction as jest.Mock).mockImplementation(
    async (fn: (tx: unknown) => unknown) => fn(prismaMock)
  );
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Returns a Date object `days` days from now. */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

/** Returns a Date object `days` days ago. */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

// ---------------------------------------------------------------------------
// Request factory
// ---------------------------------------------------------------------------

/** Creates a Next.js-compatible Request object for route handler testing. */
export function makeRequest(
  url: string,
  options: { method?: string; body?: unknown; cookies?: Record<string, string> } = {}
): Request {
  const { method = "GET", body } = options;
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
