// app/api/student/daily-tasks/[taskId]/upload-audio/route.ts
// Deprecated. Upload flow now uses /api/upload/presign + R2 direct PUT + /api/upload/confirm.

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