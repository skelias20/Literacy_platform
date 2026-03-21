// app/api/student/assessment/submit/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyStudentJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { IdSchema, SkillSchema } from "@/lib/schemas";

// Max text length per response — prevents oversized payloads reaching the DB.
// 5000 chars is generous for a literacy assessment writing/listening response.
const MAX_TEXT_LENGTH = 5000;

const AssessmentSubmitSchema = z.object({
  assessmentId: IdSchema,
  responses: z.record(SkillSchema, z.string().max(MAX_TEXT_LENGTH).trim().optional()).optional()
});

export async function POST(req: Request) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const cookieStore = await cookies();
    const token = cookieStore.get("student_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let childId: string;
    try {
      const payload = verifyStudentJwt(token);
      childId = payload.childId;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Parse + validate input ────────────────────────────────────────────
    const parsed = parseBody(
      AssessmentSubmitSchema,
      await req.json().catch(() => null),
      "assessment/submit"
    );
    if (!parsed.ok) return parsed.response;
    const { assessmentId, responses = {} } = parsed.data;

    // ── Business logic checks ─────────────────────────────────────────────
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { child: true },
    });

    if (!assessment || assessment.childId !== childId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (assessment.kind !== "initial") {
      return NextResponse.json({ error: "Invalid assessment kind" }, { status: 400 });
    }

    if (assessment.submittedAt) {
      return NextResponse.json({ error: "Assessment already submitted" }, { status: 409 });
    }

    // ── Persist inside transaction ────────────────────────────────────────
    await prisma.$transaction(async (tx) => {
      // Clear prior text artifacts only — preserve audio file artifacts
      await tx.assessmentArtifact.deleteMany({
        where: { assessmentId: assessment.id, fileId: null },
      });

      // Persist each non-empty text response
      for (const [skill, text] of Object.entries(responses) as [string, string][]) {
        if (!text) continue;
        await tx.assessmentArtifact.create({
          data: {
            assessmentId: assessment.id,
            skill: skill as "reading" | "listening" | "writing" | "speaking",
            textBody: text,
          },
        });
      }

      await tx.assessment.update({
        where: { id: assessment.id },
        data: { submittedAt: new Date() },
      });

      // Status transition: assessment_required → pending_level_review
      // Admin must review artifacts and assign level before student becomes active.
      await tx.child.update({
        where: { id: childId },
        data: { status: "pending_level_review" },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}