// lib/fetchWithAuth.ts
// Drop-in wrapper around fetch for use in student and admin pages.
// When an API route returns 401, the token has expired mid-session
// (middleware checked it on page load but it expired during the visit).
// This wrapper detects that and redirects to the correct login page
// with ?expired=1 so the user sees a clear message instead of a broken UI.
//
// Usage — replace:
//   const res = await fetch("/api/student/...")
// With:
//   const res = await studentFetch("/api/student/...")
//
// fetchWithAuth never throws on 401 — it redirects instead.
// All other responses (including errors) are returned normally.

type FetchArgs = Parameters<typeof fetch>;

function makeFetchWithAuth(loginPath: string) {
  return async function fetchWithAuth(
    input: FetchArgs[0],
    init?: FetchArgs[1]
  ): Promise<Response> {
    const res = await fetch(input, init);

    if (res.status === 401) {
      // Token expired mid-session. Redirect to login with expired flag.
      // Use window.location instead of router.push because this utility
      // is used outside React component trees (plain async functions).
      if (typeof window !== "undefined") {
        window.location.href = `${loginPath}?expired=1`;
      }
      // Return the response anyway so callers don't need special handling —
      // the redirect will fire and the page will unload before any await resolves.
      return res;
    }

    return res;
  };
}

// Use studentFetch in all student pages instead of raw fetch
export const studentFetch = makeFetchWithAuth("/student/login");

// Use adminFetch in all admin pages instead of raw fetch
export const adminFetch = makeFetchWithAuth("/admin/login");