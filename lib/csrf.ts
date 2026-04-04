// lib/csrf.ts
// CSRF protection via Origin header validation.
//
// Protects all state-mutating authenticated routes against cross-site request
// forgery. sameSite: "lax" is a first line of defence; explicit origin checking
// adds a second layer that remains effective even if cookie settings change.
//
// Usage: pass `req` to requireAdminAuth(req) / requireStudentAuth(req) in
// mutation route handlers. The check only fires for POST/PUT/PATCH/DELETE — safe
// methods (GET, HEAD, OPTIONS) pass through unchanged.
//
// How it works:
//   Browsers always include the Origin header on cross-origin and same-origin
//   state-mutating requests made via fetch() or XMLHttpRequest. If the Origin
//   does not match the Host, or if Origin is absent (non-browser callers only),
//   the request is rejected before any cookie or DB access occurs.

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns true when the request method can mutate server state.
 * GET, HEAD, and OPTIONS are safe methods and bypass CSRF validation.
 */
export function isMutationMethod(req: Request): boolean {
  return MUTATION_METHODS.has(req.method.toUpperCase());
}

/**
 * Validates that the `Origin` header matches the `Host` header.
 *
 * Returns true  → same-origin request, allow
 * Returns false → cross-origin or missing Origin header, deny
 *
 * Rejecting requests without an Origin header is safe for this platform —
 * all legitimate callers are browsers, which always set Origin on mutations.
 */
export function validateOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
