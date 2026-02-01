import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const SECRET = mustGetEnv("JWT_SECRET");

type ReqBody = {
  assessmentId: string;
  level: "foundational" | "functional" | "transitional" | "advanced";
};

export async function POST(req: Request) {
  try {
    // --- admin auth ---
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = jwt.verify(token, SECRET);
    if (typeof decoded !== "object" || decoded === null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const payload = decoded as jwt.JwtPayload;
    const adminId = payload.adminId;
    if (typeof adminId !== "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Partial<ReqBody>;
    const assessmentId = (body.assessmentId ?? "").trim();
    const level = body.level;

    if (!assessmentId) {
      return NextResponse.json({ error: "assessmentId is required" }, { status: 400 });
    }
    if (!level || !["foundational", "functional", "transitional", "advanced"].includes(level)) {
      return NextResponse.json({ error: "Invalid level" }, { status: 400 });
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, childId: true, submittedAt: true,assignedLevel: true  },
    });

    if (!assessment) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    if (!assessment.submittedAt) {
      return NextResponse.json({ error: "Assessment not submitted yet" }, { status: 400 });
    }

    if (assessment.assignedLevel) {
      return NextResponse.json({ error: "Level already assigned" }, { status: 409 });
    }
    
    // atomic update
    await prisma.$transaction(async (tx) => {
      await tx.assessment.update({
        where: { id: assessmentId },
        data: {
          assignedLevel: level,
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
        },
      });

      await tx.child.update({
        where: { id: assessment.childId },
        data: {
          level,
          status: "active",
          levelAssignedById: adminId,
          levelAssignedAt: new Date(),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "LEVEL_ASSIGNED",
          targetAssessmentId: assessmentId,
          targetChildId: assessment.childId,
          metadata: { level },
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "JsonWebTokenError") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
