// app/api/upload/confirm/route.ts
// Frontend fallback confirm endpoint.
// Idempotent — safe to call even if the Worker already completed the file.
// Does NOT blindly mark COMPLETED — checks current status first.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { getPublicUrl, r2ObjectExists, type UploadContext } from "@/lib/r2";
import { SkillType } from "@prisma/client";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
const SECRET = mustGetEnv("JWT_SECRET");

type ConfirmBody = {
  fileId: string;
  context: UploadContext;
  // Linking fields (same as presign body)
  assessmentId?: string;
  skill?: string;
  taskId?: string;
  // For receipt: childId is derived from auth
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<ConfirmBody>;
    const fileId = (body.fileId ?? "").trim();
    const context = body.context;

    if (!fileId || !context) {
      return NextResponse.json(
        { error: "fileId and context required" },
        { status: 400 }
      );
    }

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

    const wantsStudent = context === "assessment_audio" || context === "daily_audio";
    const wantsAdmin = context === "admin_content";

    let uploaderId: string | null = null;
    let uploaderType: "admin" | "student" | null = null;

    const tryStudent = async () => {
      if (!studentToken) return;
      try {
        const p = jwt.verify(studentToken, SECRET) as jwt.JwtPayload;
        if (typeof p.childId === "string") {
          uploaderId = p.childId;
          uploaderType = "student";
        }
      } catch {
        /* fall through */
      }
    };

    const tryAdmin = async () => {
      if (!adminToken) return;
      try {
        const p = jwt.verify(adminToken, SECRET) as jwt.JwtPayload;
        if (typeof p.adminId === "string") {
          uploaderId = p.adminId;
          uploaderType = "admin";
        }
      } catch {
        /* fall through */
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

    // Receipt confirmation comes from unauthenticated registration
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
  body: Partial<ConfirmBody>;
  uploaderId: string | null;
  uploaderType: "admin" | "student" | null;
}) {
  const { file, body, uploaderId } = params;
  const context = body.context!;

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
  }
}