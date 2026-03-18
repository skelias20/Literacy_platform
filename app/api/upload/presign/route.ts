// app/api/upload/presign/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import {
  generateFileId,
  generatePresignedPutUrl,
  generateR2Key,
  validateUpload,
  type UploadContext,
} from "@/lib/r2";
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rateLimit";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SECRET = mustGetEnv("JWT_SECRET");

type PresignBody = {
  context: UploadContext;
  mimeType: string;
  byteSize: number;
  originalName: string;
  // Context-specific linking fields
  assessmentId?: string;
  skill?: string;
  taskId?: string;
};

export async function POST(req: Request) {
  try {
    // ── DIAGNOSTIC: log every step to trace the 403 ───────────────────────
    const diag: Record<string, unknown> = {};
    const deny = (status: number, error: string, extra?: Record<string, unknown>) => {
      const payload = { error, diag: { ...diag, ...(extra ?? {}) } };
      console.warn(`[upload/presign] deny ${status} ${error}`, payload.diag);
      return NextResponse.json(payload, {
        status,
        headers: { "cache-control": "no-store" },
      });
    };

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

    // Read body early so we can select the right auth token.
    // If both admin + student cookies exist (common in dev), we must prefer the
    // cookie that matches the requested upload context.
    const body = (await req.json()) as Partial<PresignBody>;
    const context = body.context;
    diag.context = context;

    // ── Auth — determine who is uploading ──────────────────────────────────
    const cookieStore = await cookies();
    const adminToken = cookieStore.get("admin_token")?.value;
    const studentToken = cookieStore.get("student_token")?.value;
    diag.hasAdminToken = !!adminToken;
    diag.hasStudentToken = !!studentToken;

    const wantsStudent =
      context === "assessment_audio" || context === "daily_audio";
    const wantsAdmin = context === "admin_content";
    diag.wantsStudent = wantsStudent;
    diag.wantsAdmin = wantsAdmin;

    let uploaderId: string | null = null;
    let uploaderType: "admin" | "student" | null = null;

    const tryStudent = async () => {
      if (!studentToken) return;
      try {
        const p = jwt.verify(studentToken, SECRET) as jwt.JwtPayload;
        if (typeof p.childId === "string") {
          uploaderId = p.childId;
          uploaderType = "student";
          diag.studentTokenValid = true;
        } else {
          diag.studentTokenValid = false;
          diag.studentTokenFields = Object.keys(p);
        }
      } catch (e) {
        diag.studentTokenError = e instanceof Error ? e.message : String(e);
      }
    };

    const tryAdmin = async () => {
      if (!adminToken) return;
      try {
        const p = jwt.verify(adminToken, SECRET) as jwt.JwtPayload;
        if (typeof p.adminId === "string") {
          uploaderId = p.adminId;
          uploaderType = "admin";
          diag.adminTokenValid = true;
        } else {
          diag.adminTokenValid = false;
          diag.adminTokenFields = Object.keys(p);
        }
      } catch (e) {
        diag.adminTokenError = e instanceof Error ? e.message : String(e);
      }
    };

    // Prefer the token that matches the context.
    if (wantsStudent) {
      await tryStudent();
      if (!uploaderId) await tryAdmin();
    } else if (wantsAdmin) {
      await tryAdmin();
      if (!uploaderId) await tryStudent();
    } else {
      // receipt (or unknown) — try both, order doesn't matter
      await tryStudent();
      if (!uploaderId) await tryAdmin();
    }

    diag.uploaderId = uploaderId ? "SET" : null;
    diag.uploaderType = uploaderType;

    // Receipt uploads come from unauthenticated registration flow
    const isRegistrationReceipt = context === "receipt";

    if (!isRegistrationReceipt && !uploaderId) {
      return deny(401, "Unauthorized");
    }

    // ── Validate context ──────────────────────────────────────────────────
    const validContexts: UploadContext[] = [
      "receipt",
      "assessment_audio",
      "daily_audio",
      "admin_content",
    ];
    if (!context || !validContexts.includes(context)) {
      return deny(400, "Invalid context");
    }

    // Admin-only contexts
    if (context === "admin_content" && uploaderType !== "admin") {
      return deny(403, "Forbidden: admin_content requires admin");
    }

    // Student-only contexts
    if (
      (context === "assessment_audio" || context === "daily_audio") &&
      uploaderType !== "student"
    ) {
      return deny(403, "Forbidden: assessment_audio/daily_audio requires student");
    }

    const mimeType = (body.mimeType ?? "").trim();
    const byteSize = Number(body.byteSize ?? 0);
    const originalName = (body.originalName ?? "upload").trim();

    // ── Validate file constraints ─────────────────────────────────────────
    const validation = validateUpload(context, mimeType, byteSize);
    if (!validation.ok) {
      return deny(400, validation.error);
    }

    // ── Context-specific validation ───────────────────────────────────────
    const skill = body.skill;
    const taskId = body.taskId;
    const assessmentId = body.assessmentId;

    if (context === "assessment_audio") {
      if (!assessmentId || !skill) {
        return deny(400, "assessmentId and skill required for assessment_audio");
      }
      // Verify assessment belongs to this student
      const assessment = await prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { childId: true, submittedAt: true },
      });
      if (!assessment || assessment.childId !== uploaderId) {
        return deny(404, "Not found");
      }
      if (assessment.submittedAt) {
        return deny(409, "Assessment already submitted");
      }
    }

    if (context === "daily_audio") {
      if (!taskId || !skill) {
        return deny(400, "taskId and skill required for daily_audio");
      }
      // Verify task exists and student has access
      const task = await prisma.dailyTask.findUnique({
        where: { id: taskId },
        select: { level: true, skill: true },
      });
      if (!task) {
        return deny(404, "Task not found");
      }
      const child = await prisma.child.findUnique({
        where: { id: uploaderId! },
        select: { level: true, status: true },
      });
      if (!child || child.status !== "active") {
        return deny(403, "Forbidden");
      }
      if (task.level !== null && child.level !== task.level) {
        return deny(404, "Not found");
      }
      // Check submission not already locked
      const existing = await prisma.dailySubmission.findUnique({
        where: {
          childId_dailyTaskId: { childId: uploaderId!, dailyTaskId: taskId },
        },
        select: { isCompleted: true },
      });
      if (existing?.isCompleted) {
        return deny(409, "Task already submitted");
      }
    }

    // ── Generate file ID and R2 key ───────────────────────────────────────
    const fileId = generateFileId();
    const r2Key = generateR2Key({
      context,
      fileId,
      mimeType,
      childId: uploaderType === "student" ? uploaderId! : undefined,
      skill,
      taskId,
      adminId: uploaderType === "admin" ? uploaderId! : undefined,
    });

    // ── Create PENDING File record ────────────────────────────────────────
    await prisma.file.create({
      data: {
        id: fileId,
        storageKey: r2Key,
        r2Key,
        originalName,
        mimeType,
        byteSize: BigInt(byteSize),
        uploadStatus: "PENDING",
        uploadedByChildId: uploaderType === "student" ? uploaderId : null,
        uploadedByAdminId: uploaderType === "admin" ? uploaderId : null,
      },
    });

    // ── Generate presigned URL ────────────────────────────────────────────
    const presignedUrl = await generatePresignedPutUrl({
      r2Key,
      mimeType,
      byteSize,
    });

    return NextResponse.json({ presignedUrl, fileId, r2Key });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}