/* import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login page and login endpoint
  if (pathname.startsWith("/admin/login") || pathname.startsWith("/api/admin/login")) {
    return NextResponse.next();
  }

  // Protect all /admin routes
  if (pathname.startsWith("/admin")) {
    const token = req.cookies.get("admin_token")?.value;
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
  }

    // Protect all /student routes
    if (pathname.startsWith("/student")) {
      const token = req.cookies.get("student_token")?.value;
      if (!token) {
        const url = req.nextUrl.clone();
        url.pathname = "/student/login";
        return NextResponse.redirect(url);
      }
    }
    
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/student/:path*", "/api/student/:path*" ],
}; */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow Next internals + static assets + public files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/assessment/") || // your public assessment assets
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  // --- Student auth ---
  const studentToken = req.cookies.get("student_token")?.value;

  const isStudentLogin = pathname === "/student/login";
  const isStudentRoute = pathname.startsWith("/student");

  if (isStudentRoute && !isStudentLogin) {
    if (!studentToken) {
      const url = req.nextUrl.clone();
      url.pathname = "/student/login";
      return NextResponse.redirect(url);
    }
  }

  // --- Admin auth ---
  const adminToken = req.cookies.get("admin_token")?.value;
  const isAdminLogin = pathname === "/admin/login";
  const isAdminRoute = pathname.startsWith("/admin");

  if (isAdminRoute && !isAdminLogin) {
    if (!adminToken) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

