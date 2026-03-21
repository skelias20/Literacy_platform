// app/api/upload/presign/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyAdminJwt, verifyStudentJwt } from "@/lib/auth";
import {
  generateFileId,
  generatePresignedPutUrl,
  generateR2Key,
  validateUpload,
  type UploadContext,
} from "@/lib/r2";
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rateLimit";
import { parseBody } from "@/lib/parseBody";

export const runtime = "nodejs";

// ── Presign request schema ────────────────────────────────────────────────
const VALID_CONTEXTS = [
  "receipt",
  "assessment_audio",
  "daily_audio",
  "admin_content",
] as const;

const PresignSchema = z.object({
  context:      z.enum(VALID_CONTEXTS),
  mimeType:     z.string().min(1).max(128).trim(),
  byteSize:     z.number().int().positive().max(100 * 1024 * 1024), // hard ceiling 100MB
  originalName: z.string().min(1).max(255).trim(),
  // Context-specific linking fields — optional at schema level,
  // enforced by context-specific business logic checks below
  assessmentId: z.string().max(128).trim().optional(),
  skill:        z.string().max(32).trim().optional(),
  taskId:       z.string().max(128).trim().optional(),
});

export async function POST(req: Request) {
  // Diagnostic object — helps trace auth failures in logs
  const diag: Record<string, unknown> = {};

  const deny = (status: number, error: string, extra?: Record<string, unknown>) => {
    const payload = { error, diag: { ...diag, ...(extra ?? {}) } };
    console.warn(`[upload/presign] deny ${status} ${error}`, payload.diag);
    return NextResponse.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  };

  try {
    // ── Rate limit ────────────────────────────────────────────────────────
    const ip = getClientIp(req);
    diag.ip = ip;
    diag.nodeEnv = process.env.NODE_ENV;

    const rl = rateLimit(`presign:${ip}`, RATE_LIMITS.presign);
    diag.rateLimitAllowed = rl.allowed;
    if (!rl.allowed) {
      return deny(429, "Too many requests", {
        retryAfterMs: (rl as { retryAfterMs: number }).retryAfterMs,
      });
    }

    // ── Parse + validate input ────────────────────────────────────────────
    // Body must be read before cookies to get context for auth selection.
    const rawBody = await req.json().catch(() => null);
    const parsed = parseBody(PresignSchema, rawBody, "upload/presign");
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    diag.context = body.context;

    // ── Auth — context-aware token selection ──────────────────────────────
    // Use the canonical verifiers from lib/auth.ts which enforce role claim
    // and algorithm restriction. The old inline jwt.verify calls are replaced.
    const cookieStore = await cookies();
    const adminToken   = cookieStore.get("admin_token")?.value;
    const studentToken = cookieStore.get("student_token")?.value;
    diag.hasAdminToken   = !!adminToken;
    diag.hasStudentToken = !!studentToken;

    const wantsStudent = body.context === "assessment_audio" || body.context === "daily_audio";
    const wantsAdmin   = body.context === "admin_content";
    diag.wantsStudent = wantsStudent;
    diag.wantsAdmin   = wantsAdmin;

    let uploaderId:    string | null = null;
    let uploaderType: "admin" | "student" | null = null;

    const tryStudent = () => {
      if (!studentToken) return;
      try {
        const p = verifyStudentJwt(studentToken);
        uploaderId   = p.childId;
        uploaderType = "student";
        diag.studentTokenValid = true;
      } catch (e) {
        diag.studentTokenError = e instanceof Error ? e.message : String(e);
      }
    };

    const tryAdmin = () => {
      if (!adminToken) return;
      try {
        const p = verifyAdminJwt(adminToken);
        uploaderId   = p.adminId;
        uploaderType = "admin";
        diag.adminTokenValid = true;
      } catch (e) {
        diag.adminTokenError = e instanceof Error ? e.message : String(e);
      }
    };

    // Prefer the token that matches the context
    if (wantsStudent) {
      tryStudent();
      if (!uploaderId) tryAdmin();
    } else if (wantsAdmin) {
      tryAdmin();
      if (!uploaderId) tryStudent();
    } else {
      // receipt — unauthenticated, try both anyway for logging
      tryStudent();
      if (!uploaderId) tryAdmin();
    }

    diag.uploaderId   = uploaderId ? "SET" : null;
    diag.uploaderType = uploaderType;

    // Receipt uploads come from unauthenticated registration flow
    const isRegistrationReceipt = body.context === "receipt";
    if (!isRegistrationReceipt && !uploaderId) {
      return deny(401, "Unauthorized");
    }

    // ── Role enforcement ──────────────────────────────────────────────────
    if (body.context === "admin_content" && uploaderType !== "admin") {
      return deny(403, "Forbidden: admin_content requires admin");
    }
    if (
      (body.context === "assessment_audio" || body.context === "daily_audio") &&
      uploaderType !== "student"
    ) {
      return deny(403, "Forbidden: assessment_audio/daily_audio requires student");
    }

    // ── File constraints (size + MIME via existing validateUpload) ────────
    const validation = validateUpload(body.context, body.mimeType, body.byteSize);
    if (!validation.ok) {
      return deny(400, validation.error);
    }

    // ── Context-specific business logic ───────────────────────────────────
    if (body.context === "assessment_audio") {
      if (!body.assessmentId || !body.skill) {
        return deny(400, "assessmentId and skill required for assessment_audio");
      }
      const assessment = await prisma.assessment.findUnique({
        where: { id: body.assessmentId },
        select: { childId: true, submittedAt: true },
      });
      if (!assessment || assessment.childId !== uploaderId) {
        return deny(404, "Not found");
      }
      if (assessment.submittedAt) {
        return deny(409, "Assessment already submitted");
      }
    }

    if (body.context === "daily_audio") {
      if (!body.taskId || !body.skill) {
        return deny(400, "taskId and skill required for daily_audio");
      }
      const task = await prisma.dailyTask.findUnique({
        where: { id: body.taskId },
        select: { level: true, skill: true },
      });
      if (!task) return deny(404, "Task not found");

      const child = await prisma.child.findUnique({
        where: { id: uploaderId! },
        select: { level: true, status: true },
      });
      if (!child || child.status !== "active") return deny(403, "Forbidden");
      if (task.level !== null && child.level !== task.level) return deny(404, "Not found");

      const existing = await prisma.dailySubmission.findUnique({
        where: {
          childId_dailyTaskId: { childId: uploaderId!, dailyTaskId: body.taskId },
        },
        select: { isCompleted: true },
      });
      if (existing?.isCompleted) return deny(409, "Task already submitted");
    }

    // ── Generate file ID, R2 key, PENDING File record ─────────────────────
    const fileId = generateFileId();
    const r2Key  = generateR2Key({
      context:  body.context,
      fileId,
      mimeType: body.mimeType,
      childId:  uploaderType === "student" ? uploaderId! : undefined,
      skill:    body.skill,
      taskId:   body.taskId,
      adminId:  uploaderType === "admin"   ? uploaderId! : undefined,
    });

    await prisma.file.create({
      data: {
        id:               fileId,
        storageKey:       r2Key,
        r2Key,
        originalName:     body.originalName,
        mimeType:         body.mimeType,
        byteSize:         BigInt(body.byteSize),
        uploadStatus:     "PENDING",
        uploadedByChildId: uploaderType === "student" ? uploaderId : null,
        uploadedByAdminId: uploaderType === "admin"   ? uploaderId : null,
      },
    });

    const presignedUrl = await generatePresignedPutUrl({
      r2Key,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
    });

    return NextResponse.json({ presignedUrl, fileId, r2Key });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}