import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyStudentJwt } from "@/lib/auth";

type Skill = "reading" | "listening" | "writing" | "speaking";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = verifyStudentJwt(token);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const assessmentId = String(body.assessmentId ?? "");
  const responses = (body.responses ?? {}) as Partial<Record<Skill, string>>;

  if (!assessmentId) {
    return NextResponse.json({ error: "Missing assessmentId" }, { status: 400 });
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: { child: true },
  });

  if (!assessment || assessment.childId !== payload.childId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (assessment.kind !== "initial") {
    return NextResponse.json({ error: "Invalid assessment kind" }, { status: 400 });
  }

  // Store artifacts (text only). We’ll add audio/file upload later.
  const skills: Skill[] = ["reading", "listening", "writing", "speaking"];

  await prisma.$transaction(async (tx) => {
    // Optional: clear prior artifacts to allow re-submit
   // await tx.assessmentArtifact.deleteMany({ where: { assessmentId: assessment.id } });
   // Only clear text artifacts (keep file uploads like audio)
await tx.assessmentArtifact.deleteMany({
  where: {
    assessmentId: assessment.id,
    fileId: null, // keep file-based artifacts
  },
});

    for (const s of skills) {
      const text = (responses[s] ?? "").trim();
      if (!text) continue;

      await tx.assessmentArtifact.create({
        data: {
          assessmentId: assessment.id,
          skill: s,
          textBody: text,
        },
      });
    }

    await tx.assessment.update({
      where: { id: assessment.id },
      data: { submittedAt: new Date() },
    });

    // IMPORTANT: Do NOT set child to active here. Admin must review & assign level.
    // Keep status as assessment_required until admin assigns a level.
  });

  return NextResponse.json({ ok: true });
}
