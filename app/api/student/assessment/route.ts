// app/api/student/assessment/route.ts
// CHANGE FROM v1: taskFormat is no longer read from AssessmentConfig.
// It is derived at assessment-row creation time from the listening slot's question bank.
// If the listening slot has a question bank, the format is taken from the first question's type.
// If no question bank exists, format defaults to free_response.
//
// CHANGE: Initial assessment content is now derived from the student's registration grade,
// not defaulted to "foundational". Grade mapping: 1-2 → foundational, 3-4 → functional,
// 5-6 → transitional, 7-8 → advanced. (Confirmed product decision, Session V)
//
// CHANGE: If an existing assessment row has taskFormat "free_response" but the slot now has
// a question bank configured, the taskFormat is updated before returning. This allows admins
// to configure a question bank after a student's assessment row was already created.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentAuth } from "@/lib/serverAuth";
import type { LiteracyLevel } from "@prisma/client";

export const runtime = "nodejs";

// Derive TaskFormat from a question bank JSON string.
// Returns the type of the first question, or "free_response" if not determinable.
function deriveFormatFromBank(textBody: string | null): "free_response" | "mcq" | "msaq" | "fill_blank" {
  if (!textBody) return "free_response";
  try {
    const bank = JSON.parse(textBody) as { questions: Array<{ type: string }> };
    const firstType = bank.questions?.[0]?.type;
    if (firstType === "mcq" || firstType === "msaq" || firstType === "fill_blank") return firstType;
  } catch { /* fall through */ }
  return "free_response";
}

// Map registration grade (1–12) to a literacy level for initial assessment content lookup.
// Grades 1–2 → foundational, 3–4 → functional, 5–6 → transitional, 7–12 → advanced.
function gradeToLevel(grade: number): LiteracyLevel {
  if (grade <= 2) return "foundational";
  if (grade <= 4) return "functional";
  if (grade <= 6) return "transitional";
  return "advanced";
}

export async function GET() {
  const student = await requireStudentAuth();
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const childId = student.childId;

  const child = await prisma.child.findUnique({ where: { id: childId } });
  if (!child) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowedStatuses = ["assessment_required", "active"];
  if (!allowedStatuses.includes(child.status)) {
    return NextResponse.json({ blocked: true, status: child.status }, { status: 409 });
  }

  const kind = child.status === "assessment_required" ? "initial" : "periodic";
  if (kind === "periodic" && !child.level) {
    return NextResponse.json(
      { blocked: true, status: child.status, reason: "no_level_assigned" },
      { status: 409 }
    );
  }

  // Level used for slot lookup and content loading.
  // Initial: derived from grade (no level assigned yet).
  // Periodic: use the student's assigned level.
  const levelFilter: LiteracyLevel = kind === "initial"
    ? gradeToLevel(child.grade)
    : (child.level ?? "foundational");

  const config = await prisma.assessmentConfig.findFirst({
    orderBy: { createdAt: "asc" },
    select: { initialSessionCount: true, periodicSessionCount: true },
  });
  const initialSessionCount  = config?.initialSessionCount  ?? 1;
  const periodicSessionCount = config?.periodicSessionCount ?? 1;

  // ── Find or create the open assessment row ────────────────────────────
  let assessment = await prisma.assessment.findFirst({
    where: { childId, kind, isLatest: true, submittedAt: null },
    orderBy: { sessionNumber: "desc" },
  });

  if (!assessment && kind === "initial") {
    // Derive format from the session-1 listening slot for the student's grade-mapped level.
    const listeningSlot = await prisma.assessmentDefaultContent.findUnique({
      where: {
        level_skill_sessionNumber: {
          level: levelFilter,
          skill: "listening",
          sessionNumber: 1,
        },
      },
      select: {
        contentItem: {
          select: {
            questionBank: { select: { textBody: true, deletedAt: true } },
          },
        },
      },
    });

    const qbText = listeningSlot?.contentItem?.questionBank;
    const derivedFormat = (!qbText || qbText.deletedAt)
      ? "free_response"
      : deriveFormatFromBank(qbText.textBody);

    await prisma.assessment.updateMany({
      where: { childId, kind: "initial", isLatest: true },
      data: { isLatest: false },
    });
    assessment = await prisma.assessment.create({
      data: {
        childId,
        kind: "initial",
        sessionNumber: 1,
        isLatest: true,
        startedAt: new Date(),
        taskFormat: derivedFormat,
        // Snapshot the grade-mapped level so future loads always use the same level band,
        // even if the admin reconfigures slots or the grade mapping changes.
        lookupLevel: levelFilter,
      },
    });
  }

  if (!assessment) {
    return NextResponse.json(
      { blocked: true, status: child.status, reason: "no_pending_assessment" },
      { status: 409 }
    );
  }

  // Use the level stored at assessment creation time for all slot lookups.
  // This ensures a student always sees content from the same level band for the life
  // of their assessment, regardless of admin slot changes or grade mapping updates.
  // Old rows (created before this field was added) have lookupLevel = null.
  // For those, fall back to "foundational" for initial (old pre-migration behavior)
  // or the student's assigned level for periodic.
  const effectiveLevel: LiteracyLevel = assessment.lookupLevel
    ?? (kind === "initial" ? "foundational" : (child.level ?? "foundational"));

  // sessionNumber maps directly to the content slot session number for both kinds.
  // For periodic, session 1 of a cycle maps to slot session 1, session 2 maps to slot session 2, etc.
  const slotSessionNumber = assessment.sessionNumber;

  // ── Re-derive taskFormat if currently free_response but slot now has a QB ────
  // Handles the case where an admin configures a question bank after the assessment
  // row was already created. Without this, the student would see the free-text textarea
  // even though a structured question bank is now configured.
  if (assessment.taskFormat === "free_response") {
    const currentListeningSlot = await prisma.assessmentDefaultContent.findUnique({
      where: {
        level_skill_sessionNumber: {
          level: effectiveLevel,
          skill: "listening",
          sessionNumber: slotSessionNumber,
        },
      },
      select: {
        contentItem: {
          select: {
            questionBank: { select: { textBody: true, deletedAt: true } },
          },
        },
      },
    });
    const currentQb = currentListeningSlot?.contentItem?.questionBank;
    if (currentQb && !currentQb.deletedAt && currentQb.textBody) {
      const updatedFormat = deriveFormatFromBank(currentQb.textBody);
      if (updatedFormat !== "free_response") {
        await prisma.assessment.update({
          where: { id: assessment.id },
          data: { taskFormat: updatedFormat },
        });
        assessment = { ...assessment, taskFormat: updatedFormat };
      }
    }
  }

  // ── Load content from slots ───────────────────────────────────────────

  const slots = await prisma.assessmentDefaultContent.findMany({
    where: {
      sessionNumber: slotSessionNumber,
      level: effectiveLevel,
    },
    select: {
      skill: true,
      contentItem: {
        select: {
          id: true, title: true, description: true,
          skill: true, type: true, textBody: true,
          assetUrl: true, mimeType: true,
          questionBank: {
            select: { id: true, textBody: true, deletedAt: true },
          },
        },
      },
    },
  });

  // All four skills must have a slot. If even one is missing, the assessment cannot proceed.
  // A partial slot config (e.g. 3/4 skills filled) would let students submit with empty sections.
  const REQUIRED_SKILLS = ["reading", "listening", "writing", "speaking"] as const;
  const configuredSkills = new Set(slots.map((s) => s.skill));
  const missingSkills = REQUIRED_SKILLS.filter((sk) => !configuredSkills.has(sk));

  if (missingSkills.length > 0) {
    return NextResponse.json(
      {
        blocked: true,
        status: child.status,
        reason: "content_not_configured",
        message: "Your assessment is being prepared. Please check back soon.",
      },
      { status: 409 }
    );
  }

  const taskFormat = assessment.taskFormat;
  const isStructured = taskFormat === "mcq" || taskFormat === "msaq" || taskFormat === "fill_blank";

  const content = slots.map(({ contentItem }) => {
    if (isStructured && contentItem.skill === "listening") {
      const qb = contentItem.questionBank;
      if (qb && !qb.deletedAt && qb.textBody) {
        try {
          const bank = JSON.parse(qb.textBody) as { questions: Array<Record<string, unknown>> };
          const stripped = {
            questions: bank.questions.map((q) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { correctAnswer, correctAnswers, ...safe } = q;
              void correctAnswer; void correctAnswers;
              return safe;
            }),
          };
          return {
            id: contentItem.id, title: contentItem.title, description: contentItem.description,
            skill: contentItem.skill, type: contentItem.type,
            textBody: JSON.stringify(stripped),
            assetUrl: contentItem.assetUrl, mimeType: contentItem.mimeType,
          };
        } catch { /* fall through to unstripped */ }
      }
    }
    return {
      id: contentItem.id, title: contentItem.title, description: contentItem.description,
      skill: contentItem.skill, type: contentItem.type, textBody: contentItem.textBody,
      assetUrl: contentItem.assetUrl, mimeType: contentItem.mimeType,
    };
  });

  return NextResponse.json({
    assessmentId: assessment.id,
    sessionNumber: assessment.sessionNumber,
    totalSessions: kind === "periodic" ? periodicSessionCount : initialSessionCount,
    taskFormat,
    content,
  });
}