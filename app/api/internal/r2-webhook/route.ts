// app/api/internal/r2-webhook/route.ts
// Called by the Cloudflare Worker when R2 confirms a file has been uploaded.
// Validates WORKER_SECRET header before doing anything.
// Idempotent — safe to retry.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPublicUrl, r2ObjectExists } from "@/lib/r2";
import { SkillType } from "@prisma/client";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const WORKER_SECRET = mustGetEnv("WORKER_SECRET");

type WebhookBody = {
  r2Key: string;      // the R2 object key that was uploaded
  fileId?: string;    // optional — Worker may include if it stored it
};

export async function POST(req: Request) {
  try {
    // ── Validate Worker secret ────────────────────────────────────────────
    const authHeader = req.headers.get("x-worker-secret");
    if (!authHeader || authHeader !== WORKER_SECRET) {
      // Return 401 but don't reveal why — treat as opaque security check
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Partial<WebhookBody>;
    const r2Key = (body.r2Key ?? "").trim();

    if (!r2Key) {
      return NextResponse.json({ error: "r2Key required" }, { status: 400 });
    }

    // ── Find the File record by r2Key ─────────────────────────────────────
    const file = await prisma.file.findFirst({
      where: { r2Key },
      select: {
        id: true,
        r2Key: true,
        uploadStatus: true,
        uploadedByChildId: true,
        mimeType: true,
      },
    });

    if (!file) {
      // Could be a file we didn't create (e.g. manual R2 upload).
      // Return 200 to prevent Worker from retrying indefinitely.
      return NextResponse.json({ ok: true, skipped: true });
    }

    // ── Idempotency — already handled ────────────────────────────────────
    if (file.uploadStatus === "COMPLETED") {
      return NextResponse.json({ ok: true, alreadyCompleted: true });
    }

    // ── Verify file exists in R2 ──────────────────────────────────────────
    const exists = await r2ObjectExists(r2Key);
    if (!exists) {
      await prisma.file.update({
        where: { id: file.id },
        data: {
          uploadStatus: "FAILED",
          failureReason: "r2-webhook: object not found in R2",
        },
      });
      return NextResponse.json({ ok: false, error: "Object not in R2" }, { status: 422 });
    }

    // ── Mark COMPLETED ────────────────────────────────────────────────────
    const storageUrl = getPublicUrl(r2Key);
    await prisma.file.update({
      where: { id: file.id },
      data: { uploadStatus: "COMPLETED", storageUrl },
    });

    return NextResponse.json({ ok: true, fileId: file.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    // Return 500 so Worker retries via Queue retry policy
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}