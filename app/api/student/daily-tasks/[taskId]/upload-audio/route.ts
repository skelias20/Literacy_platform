// app/api/student/daily-tasks/[taskId]/upload-audio/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { SkillType } from "@prisma/client";
import fs from "fs/promises";
import path from "path";
// c
export const runtime = "nodejs";

type StudentJwtPayload = { childId: string; username: string };

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
const SECRET = mustGetEnv("JWT_SECRET");

async function requireStudent(): Promise<StudentJwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return null;

  const decoded = jwt.verify(token, SECRET);
  if (typeof decoded !== "object" || decoded === null) return null;

  const payload = decoded as jwt.JwtPayload;
  const childId = payload.childId;
  const username = payload.username;

  if (typeof childId !== "string" || typeof username !== "string") return null;
  return { childId, username };
}

function safeExtFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("wav")) return "wav";
  return "dat";
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await ctx.params;

    const student = await requireStudent();
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const child = await prisma.child.findUnique({
      where: { id: student.childId },
      select: { id: true, level: true, status: true },
    });
    if (!child) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (child.status !== "active") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const task = await prisma.dailyTask.findUnique({
      where: { id: taskId },
      select: { id: true, skill: true, level: true },
    });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (task.level !== null && child.level !== task.level) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only reading/speaking need audio in demo
    if (task.skill !== "reading" && task.skill !== "speaking") {
      return NextResponse.json({ error: "Audio not allowed for this task" }, { status: 400 });
    }

    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }

    // Ensure (childId, dailyTaskId) submission row exists
    const submission = await prisma.dailySubmission.upsert({
      where: { childId_dailyTaskId: { childId: child.id, dailyTaskId: task.id } },
      update: {},
      create: { childId: child.id, dailyTaskId: task.id },
      select: { id: true, isCompleted: true },
    });

    // Lock rule: cannot change once submitted
    if (submission.isCompleted) {
      return NextResponse.json({ error: "Already submitted" }, { status: 409 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = safeExtFromMime(file.type || "audio/webm");

    // Store under /uploads (NOT public). Admin will download via APIs.
    const relDir = path.join("uploads", "daily", child.id, task.id);
    const absDir = path.join(process.cwd(), relDir);
    await fs.mkdir(absDir, { recursive: true });

    const filename = `${Date.now()}-${task.skill}.${ext}`;
    const relPath = path.join(relDir, filename);
    const absPath = path.join(process.cwd(), relPath);

    await fs.writeFile(absPath, bytes);

    const createdFile = await prisma.file.create({
      data: {
        storageKey: relPath,
        originalName: file.name || filename,
        mimeType: file.type || "application/octet-stream",
        byteSize: BigInt(bytes.length),
        uploadedByChildId: child.id,
      },
      select: { id: true },
    });

    // Replace existing artifact for this skill (allowed until submit)
    await prisma.dailySubmissionArtifact.deleteMany({
      where: { dailySubmissionId: submission.id, skill: task.skill as SkillType },
    });

    await prisma.dailySubmissionArtifact.create({
      data: {
        dailySubmissionId: submission.id,
        skill: task.skill as SkillType,
        fileId: createdFile.id,
      },
      select: { id: true },
    });

    return NextResponse.json({ fileId: createdFile.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
