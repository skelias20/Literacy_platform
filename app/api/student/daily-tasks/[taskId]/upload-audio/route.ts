// app/api/student/daily-tasks/[taskId]/upload-audio/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
const SECRET = mustGetEnv("JWT_SECRET");

type StudentJwtPayload = { childId: string; username: string };

async function requireStudent(): Promise<StudentJwtPayload | null> {
  const store = await cookies();
  const token = store.get("student_token")?.value;
  if (!token) return null;

  const decoded = jwt.verify(token, SECRET);
  if (typeof decoded !== "object" || decoded === null) return null;

  const p = decoded as jwt.JwtPayload;
  const childId = p.childId;
  const username = p.username;

  if (typeof childId !== "string" || typeof username !== "string") return null;
  return { childId, username };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const student = await requireStudent();
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await ctx.params;

  const child = await prisma.child.findUnique({
    where: { id: student.childId },
    select: { id: true, status: true, level: true },
  });
  if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (child.status !== "active") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const task = await prisma.dailyTask.findUnique({
    where: { id: taskId },
    select: { id: true, skill: true, level: true },
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only allow audio skills
  if (task.skill !== "reading" && task.skill !== "speaking") {
    return NextResponse.json({ error: "Audio not allowed for this task." }, { status: 400 });
  }

  // prevent upload after completion
  const existing = await prisma.dailySubmission.findUnique({
    where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
    select: { isCompleted: true },
  });
  if (existing?.isCompleted) {
    return NextResponse.json({ error: "Already submitted." }, { status: 409 });
  }

  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
  }

  // Save to disk
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  const uploadsDir = path.join(process.cwd(), "uploads", "daily", child.id, task.id);
  await fs.mkdir(uploadsDir, { recursive: true });

  const filename = `${task.skill}_${Date.now()}.webm`;
  const relPath = path.join("uploads", "daily", child.id, task.id, filename);
  const absPath = path.join(process.cwd(), relPath);

  await fs.writeFile(absPath, bytes);

  // Create file row
  const fileRow = await prisma.file.create({
    data: {
      storageKey: relPath.replace(/\\/g, "/"),
      originalName: file.name,
      mimeType: file.type || "audio/webm",
      byteSize: BigInt(bytes.length),
      sha256,
      uploadedByChildId: child.id,
    },
    select: { id: true },
  });

  // Ensure submission row exists (draft)
  const submission = await prisma.dailySubmission.upsert({
    where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
    update: {},
    create: {
      childId: child.id,
      dailyTaskId: task.id,
      isCompleted: false,
      rpEarned: 0,
    },
    select: { id: true },
  });

  // Replace existing artifact for this skill (draft overwrite)
  await prisma.dailySubmissionArtifact.deleteMany({
    where: { dailySubmissionId: submission.id, skill: task.skill },
  });

  await prisma.dailySubmissionArtifact.create({
    data: {
      dailySubmissionId: submission.id,
      skill: task.skill,
      fileId: fileRow.id,
      textBody: null,
    },
  });

  return NextResponse.json({ ok: true, fileId: fileRow.id });
}
