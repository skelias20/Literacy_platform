import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyStudentJwt } from "@/lib/auth";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

export const runtime = "nodejs";

function safeSkill(s: string) {
  return s === "reading" || s === "listening" || s === "writing" || s === "speaking";
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = verifyStudentJwt(token);

  const form = await req.formData();

  const assessmentId = String(form.get("assessmentId") ?? "");
  const skill = String(form.get("skill") ?? "");
  const file = form.get("file");

  if (!assessmentId) {
    return NextResponse.json({ error: "Missing assessmentId" }, { status: 400 });
  }
  if (!safeSkill(skill)) {
    return NextResponse.json({ error: "Invalid skill" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  // verify assessment belongs to this child
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
  });
  if (!assessment || assessment.childId !== payload.childId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Save to disk
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  const ext = file.type.includes("webm") ? "webm" : file.type.includes("mpeg") ? "mp3" : "bin";
  const filename = `${assessmentId}_${skill}_${Date.now()}_${sha256.slice(0, 12)}.${ext}`;
  const relPath = path.join("uploads", filename);
  const absPath = path.join(process.cwd(), relPath);

  await fs.writeFile(absPath, bytes);

  // Save File row
  const saved = await prisma.file.create({
    data: {
      storageKey: relPath,
      originalName: file.name || filename,
      mimeType: file.type || "application/octet-stream",
      byteSize: BigInt(bytes.length),
      sha256,
      uploadedByChildId: payload.childId,
    },
  });

  // Create AssessmentArtifact pointing to file
  await prisma.assessmentArtifact.create({
    data: {
      assessmentId,
      skill,
      fileId: saved.id,
      textBody: null,
    },
  });

  return NextResponse.json({ ok: true, fileId: saved.id });
}
