// lib/r2.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const r2Client = new S3Client({
  region: "auto",
  endpoint: mustGetEnv("R2_ENDPOINT"),
  credentials: {
    accessKeyId: mustGetEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: mustGetEnv("R2_SECRET_ACCESS_KEY"),
  },
  // Disable automatic checksum headers (x-amz-checksum-crc32 etc).
  // AWS SDK v3 adds these by default but browsers cannot set them on fetch PUT,
  // causing R2 to return 400 InvalidArgument/Authorization.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const BUCKET = mustGetEnv("R2_BUCKET_NAME");
const PUBLIC_URL = mustGetEnv("R2_PUBLIC_URL");

// ─── Upload constraints ────────────────────────────────────────────────────

export type UploadContext =
  | "receipt"
  | "renewal_receipt"
  | "assessment_audio"
  | "daily_audio"
  | "admin_content";

type ConstraintMap = {
  allowedMimeTypes: string[];
  maxBytes: number;
};

export const UPLOAD_CONSTRAINTS: Record<UploadContext, ConstraintMap> = {
  receipt: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    maxBytes: 5 * 1024 * 1024,
  },
  renewal_receipt: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    maxBytes: 5 * 1024 * 1024,
  },
  assessment_audio: {
    allowedMimeTypes: ["audio/webm", "audio/mpeg"],
    maxBytes: 10 * 1024 * 1024,
  },
  daily_audio: {
    allowedMimeTypes: ["audio/webm", "audio/mpeg"],
    maxBytes: 10 * 1024 * 1024,
  },
  admin_content: {
    allowedMimeTypes: ["application/pdf", "audio/mpeg"],
    maxBytes: 50 * 1024 * 1024,
  },
};

// ─── Key generation ────────────────────────────────────────────────────────

export function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "application/pdf": "pdf",
  };
  return map[mimeType] ?? "bin";
}

export function generateR2Key(params: {
  context: UploadContext;
  fileId: string;
  mimeType: string;
  childId?: string;
  skill?: string;
  taskId?: string;
  adminId?: string;
}): string {
  const ext = extFromMime(params.mimeType);
  const { context, fileId, childId, skill, taskId, adminId } = params;

  switch (context) {
    case "receipt":
      // childId is not available at registration time (child hasn't been created yet).
      // File lands at temp/{fileId}.ext in R2. storageUrl is set on confirm.
      // The register route links the fileId to the child after creation.
      return childId
        ? `receipts/${childId}/${fileId}.${ext}`
        : `temp/${fileId}.${ext}`;
    case "renewal_receipt":
      // Student is always authenticated for renewals — childId is always available.
      return `renewals/${childId}/${fileId}.${ext}`;
    case "assessment_audio":
      return `assessments/${childId}/${skill}/${fileId}.${ext}`;
    case "daily_audio":
      return `daily/${childId}/${taskId}/${skill}/${fileId}.${ext}`;
    case "admin_content":
      return `content/${adminId}/${fileId}.${ext}`;
    default:
      throw new Error(`Unknown upload context: ${context}`);
  }
}

// ─── Presigned PUT URL ────────────────────────────────────────────────────
// Signs a PUT URL for direct browser-to-R2 upload.
// ContentLength is NOT included in the signed command — including it caused
// AWS SDK v3 to add checksum headers (x-amz-checksum-crc32) that browsers
// cannot set on fetch requests, resulting in R2 400 errors.
// Size enforcement is handled server-side in the presign route before
// issuing the URL. The WHEN_REQUIRED checksum config above prevents
// the SDK from adding checksum headers automatically.

export async function generatePresignedPutUrl(params: {
  r2Key: string;
  mimeType: string;
  byteSize: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: params.r2Key,
    ContentType: params.mimeType,
    // ContentLength intentionally omitted — see note above
  });
  return getSignedUrl(r2Client, command, { expiresIn: 600 }); // 10 min
}

// ─── Presigned GET URL (private file access) ──────────────────────────────
// Used for serving private files (receipts, student audio, assessment artifacts).
// Bucket stays private — this generates a short-lived URL for authorized access.
// Default expiry is 60 seconds — long enough to load, short enough to be useless
// if intercepted.

export async function generatePresignedGetUrl(
  r2Key: string,
  expiresIn = 60
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: r2Key,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// getPublicUrl is kept for admin_content items (PDFs/audio served to students).
// Do NOT use for receipts or student audio — use generatePresignedGetUrl instead.
export function getPublicUrl(r2Key: string): string {
  return `${PUBLIC_URL}/${r2Key}`;
}

export async function deleteR2Object(r2Key: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: r2Key }));
}

export async function r2ObjectExists(r2Key: string): Promise<boolean> {
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r2Key }));
    return true;
  } catch {
    return false;
  }
}

export function validateUpload(
  context: UploadContext,
  mimeType: string,
  byteSize: number
): { ok: true } | { ok: false; error: string } {
  const constraints = UPLOAD_CONSTRAINTS[context];
  if (!constraints) return { ok: false, error: "Invalid upload context" };
  if (!constraints.allowedMimeTypes.includes(mimeType)) {
    return {
      ok: false,
      error: `Type ${mimeType} not allowed for ${context}. Allowed: ${constraints.allowedMimeTypes.join(", ")}`,
    };
  }
  if (byteSize <= 0) return { ok: false, error: "File is empty" };
  if (byteSize > constraints.maxBytes) {
    const mb = constraints.maxBytes / (1024 * 1024);
    return { ok: false, error: `File exceeds ${mb}MB limit` };
  }
  return { ok: true };
}

export function generateFileId(): string {
  return crypto.randomUUID();
}