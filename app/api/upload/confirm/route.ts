// app/api/upload/confirm/route.ts
// Frontend fallback confirm endpoint.
// Idempotent — safe to call even if the Worker already completed the file.
// Does NOT blindly mark COMPLETED — checks current status first.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getPublicUrl, r2ObjectExists } from "@/lib/r2";
import { verifyStudentToken, verifyAdminToken } from "@/lib/serverAuth";
import { validateOrigin } from "@/lib/csrf";
import { parseBody } from "@/lib/parseBody";
import { SkillType } from "@prisma/client";

export const runtime = "nodejs";

const VALID_CONTEXTS = [
  "receipt",
  "renewal_receipt",
  "assessment_audio",
  "daily_audio",
  "admin_content",
] as const;

const ConfirmSchema = z.object({
  fileId:       z.string().min(1).max(128).trim(),
  context:      z.enum(VALID_CONTEXTS),
  assessmentId: z.string().max(128).trim().optional(),
  skill:        z.string().max(32).trim().optional(),
  taskId:       z.string().max(128).trim().optional(),
});

type ConfirmBody = z.infer<typeof ConfirmSchema>;

export async function POST(req: Request) {
  try {
    // CSRF guard — all confirm calls come from the same-origin browser
    if (!validateOrigin(req)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = parseBody(ConfirmSchema, await req.json().catch(() => null), "upload/confirm");
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const { fileId, context } = body;

    const deny = (status: number, error: string, extra?: Record<string, unknown>) => {
      const payload = { error, ...(extra ?? {}) };
      console.warn(`[upload/confirm] deny ${status} ${error}`, {
        context,
        fileId,
      });
      return NextResponse.json(payload, { status, headers: { "cache-control": "no-store" } });
    };

    // ── Auth ──────────────────────────────────────────────────────────────
    // If both admin + student cookies exist (common in dev), we must prefer the
    // cookie that matches the requested upload context.
    const cookieStore = await cookies();
    const adminToken = cookieStore.get("admin_token")?.value;
    const studentToken = cookieStore.get("student_token")?.value;

    const wantsStudent = context === "assessment_audio" || context === "daily_audio" || context === "renewal_receipt";
    const wantsAdmin = context === "admin_content";

    let uploaderId: string | null = null;
    let uploaderType: "admin" | "student" | null = null;

    const tryStudent = async () => {
      if (!studentToken) return;
      const p = await verifyStudentToken(studentToken);
      if (p) {
        uploaderId = p.childId;
        uploaderType = "student";
      }
    };

    const tryAdmin = async () => {
      if (!adminToken) return;
      const p = await verifyAdminToken(adminToken);
      if (p) {
        uploaderId = p.adminId;
        uploaderType = "admin";
      }
    };

    if (wantsStudent) {
      await tryStudent();
      if (!uploaderId) await tryAdmin();
    } else if (wantsAdmin) {
      await tryAdmin();
      if (!uploaderId) await tryStudent();
    } else {
      await tryStudent();
      if (!uploaderId) await tryAdmin();
    }

    // Registration receipt confirmation is unauthenticated.
    // renewal_receipt and all other contexts require auth.
    if (context !== "receipt" && !uploaderId) {
      return deny(401, "Unauthorized");
    }

    // ── Load File record ──────────────────────────────────────────────────
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        r2Key: true,
        storageKey: true,
        uploadStatus: true,
        uploadedByChildId: true,
        uploadedByAdminId: true,
        mimeType: true,
      },
    });

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Ownership check — prevent one user confirming another's file
    if (uploaderType === "student" && file.uploadedByChildId !== uploaderId) {
      return deny(403, "Forbidden");
    }
    if (uploaderType === "admin" && file.uploadedByAdminId !== uploaderId) {
      return deny(403, "Forbidden");
    }

    // ── Idempotency guard ─────────────────────────────────────────────────
    // If Worker already completed this file, just link the artifact
    // and return success without touching the File record.
    const alreadyCompleted = file.uploadStatus === "COMPLETED";

    if (!alreadyCompleted) {
      // Verify the file actually landed in R2 before marking COMPLETED.
      // This is the key guard — never blindly mark complete.
      const r2Key = file.r2Key ?? file.storageKey;
      const exists = await r2ObjectExists(r2Key);

      if (!exists) {
        return NextResponse.json(
          { error: "File not found in storage. Upload may have failed." },
          { status: 422 }
        );
      }

      // Mark COMPLETED and set storageUrl
      const storageUrl = getPublicUrl(r2Key);
      await prisma.file.update({
        where: { id: fileId },
        data: {
          uploadStatus: "COMPLETED",
          storageUrl,
        },
      });
    }

    // ── Link artifact based on context ────────────────────────────────────
    await linkArtifact({ file, body, uploaderId, uploaderType });

    return NextResponse.json({ ok: true, fileId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function linkArtifact(params: {
  file: {
    id: string;
    r2Key: string | null;
    storageKey: string;
    uploadedByChildId: string | null;
    mimeType: string;
  };
  body: ConfirmBody;
  uploaderId: string | null;
  uploaderType: "admin" | "student" | null;
}) {
  const { file, body, uploaderId } = params;
  const context = body.context;

  switch (context) {
    case "receipt": {
      // Receipt linking is handled by the registration route directly.
      // Nothing to do here — the register route creates the Payment record.
      break;
    }

    case "assessment_audio": {
      const assessmentId = body.assessmentId;
      const skill = body.skill as SkillType | undefined;
      if (!assessmentId || !skill) break;

      // Look up the assessment so we can find the correct content slot and stamp
      // contentItemId onto the artifact. Without this, reading and speaking artifacts
      // are created without a source-content link, making admin review incomplete.
      const assessment = await prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: {
          kind: true,
          sessionNumber: true,
          lookupLevel: true,
          child: { select: { level: true } },
        },
      });

      let contentItemId: string | null = null;
      if (assessment) {
        // Periodic assessments re-use session-1 slots regardless of their sessionNumber.
        const slotSessionNumber = assessment.kind === "periodic" ? 1 : assessment.sessionNumber;
        const effectiveLevel =
          assessment.lookupLevel ??
          (assessment.kind === "initial"
            ? "foundational"
            : (assessment.child.level ?? "foundational"));

        const slot = await prisma.assessmentDefaultContent.findUnique({
          where: {
            level_skill_sessionNumber: {
              level: effectiveLevel,
              skill,
              sessionNumber: slotSessionNumber,
            },
          },
          select: { contentItemId: true },
        });
        contentItemId = slot?.contentItemId ?? null;
      }

      // Upsert: delete existing file artifact for this skill, create new one
      await prisma.assessmentArtifact.deleteMany({
        where: { assessmentId, skill, fileId: { not: null } },
      });
      await prisma.assessmentArtifact.create({
        data: { assessmentId, skill, fileId: file.id, contentItemId },
      });
      break;
    }

    case "daily_audio": {
      const taskId = body.taskId;
      const skill = body.skill as SkillType | undefined;
      const childId = uploaderId;
      if (!taskId || !skill || !childId) break;

      // Ensure submission row exists
      const submission = await prisma.dailySubmission.upsert({
        where: { childId_dailyTaskId: { childId, dailyTaskId: taskId } },
        update: {},
        create: { childId, dailyTaskId: taskId },
        select: { id: true, isCompleted: true },
      });

      if (submission.isCompleted) break; // locked, don't touch

      // Replace artifact for this skill
      await prisma.dailySubmissionArtifact.deleteMany({
        where: { dailySubmissionId: submission.id, skill },
      });
      await prisma.dailySubmissionArtifact.create({
        data: { dailySubmissionId: submission.id, skill, fileId: file.id },
      });
      break;
    }

    case "admin_content": {
      // Admin content items are created by the admin content route,
      // which calls confirm after the upload. Nothing to auto-link here.
      break;
    }

    case "renewal_receipt": {
      // The renew route links the fileId to RenewalPayment after the student submits.
      // Nothing to auto-link here.
      break;
    }
  }
}