// app/api/internal/orphan-sweep/route.ts
// Called by the Cloudflare Worker cron trigger daily at 2am UTC.
// Finds PENDING File records older than 24h, deletes them from R2,
// and marks them as FAILED in the database.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteR2Object } from "@/lib/r2";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const WORKER_SECRET = mustGetEnv("WORKER_SECRET");

export async function POST(req: Request) {
  // Validate Worker secret — same guard as the webhook
  const authHeader = req.headers.get("x-worker-secret");
  if (!authHeader || authHeader !== WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

    // Find orphaned PENDING files
    const orphans = await prisma.file.findMany({
      where: {
        uploadStatus: "PENDING",
        createdAt: { lt: cutoff },
        r2Key: { not: null },
      },
      select: { id: true, r2Key: true },
    });

    let cleaned = 0;
    const errors: string[] = [];

    for (const orphan of orphans) {
      try {
        if (orphan.r2Key) {
          await deleteR2Object(orphan.r2Key);
        }

        await prisma.file.update({
          where: { id: orphan.id },
          data: {
            uploadStatus: "FAILED",
            failureReason: "orphan_sweep: PENDING for >24h",
          },
        });

        cleaned++;
      } catch (err) {
        // Log but continue — don't let one failure stop the sweep
        const msg = err instanceof Error ? err.message : "unknown error";
        errors.push(`${orphan.id}: ${msg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      cleaned,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}