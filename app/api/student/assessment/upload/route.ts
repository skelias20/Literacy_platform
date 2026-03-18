// app/api/student/assessment/upload/route.ts
// This route is now a thin compatibility shim.
// The real upload flow uses /api/upload/presign + direct R2 PUT + /api/upload/confirm.
// This route remains for any legacy calls but redirects logic to the confirm endpoint.
// New frontend code calls presign/confirm directly — this file can be removed
// once all frontend pages are updated.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "This endpoint is deprecated. Use /api/upload/presign and /api/upload/confirm instead.",
    },
    { status: 410 }
  );
}