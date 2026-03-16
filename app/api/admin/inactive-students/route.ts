// app/api/admin/inactive-students/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const SECRET = mustGetEnv("JWT_SECRET");

function startOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export async function GET(req: Request) {
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
    if (typeof payload.adminId !== "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse ?date= param (defaults to today)
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date"); // "YYYY-MM-DD"
    const targetDate = dateParam ? new Date(`${dateParam}T00:00:00.000Z`) : startOfDayUtc(new Date());

    // Fetch all active students with their parent and level
    const activeChildren = await prisma.child.findMany({
      where: { status: "active" },
      select: {
        id: true,
        childFirstName: true,
        childLastName: true,
        level: true,
        lastDailySubmissionAt: true,
        parent: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: { childLastName: "asc" },
    });

    if (activeChildren.length === 0) {
      return NextResponse.json({ students: [] });
    }

    // For each student, find their assigned tasks for targetDate and how many they completed
    const results = await Promise.all(
      activeChildren.map(async (child) => {
        // Tasks assigned to this student's level (or global tasks)
        const assignedTasks = await prisma.dailyTask.findMany({
          where: {
            taskDate: targetDate,
            OR: [
              { level: null },
              child.level ? { level: child.level } : { level: null },
            ],
          },
          select: { id: true, skill: true },
        });

        const totalTasks = assignedTasks.length;

        if (totalTasks === 0) {
          // No tasks were assigned for this date — exclude from report
          return null;
        }

        // How many did this student complete
        const completedSubmissions = await prisma.dailySubmission.count({
          where: {
            childId: child.id,
            dailyTaskId: { in: assignedTasks.map((t) => t.id) },
            isCompleted: true,
          },
        });

        // Per-skill breakdown
        const skillBreakdown = await Promise.all(
          assignedTasks.map(async (task) => {
            const submission = await prisma.dailySubmission.findUnique({
              where: {
                childId_dailyTaskId: {
                  childId: child.id,
                  dailyTaskId: task.id,
                },
              },
              select: { isCompleted: true, submittedAt: true },
            });

            return {
              skill: task.skill,
              isCompleted: submission?.isCompleted ?? false,
              submittedAt: submission?.submittedAt ?? null,
            };
          })
        );

        // Activity status
        let activityStatus: "none" | "partial" | "complete";
        if (completedSubmissions === 0) {
          activityStatus = "none";
        } else if (completedSubmissions < totalTasks) {
          activityStatus = "partial";
        } else {
          activityStatus = "complete";
        }

        return {
          id: child.id,
          childFirstName: child.childFirstName,
          childLastName: child.childLastName,
          level: child.level,
          lastDailySubmissionAt: child.lastDailySubmissionAt,
          parent: child.parent,
          totalTasks,
          completedTasks: completedSubmissions,
          activityStatus,
          skillBreakdown,
        };
      })
    );

    // Filter out nulls (students with no tasks that day) and sort:
    // none first, then partial, then complete
    const statusOrder = { none: 0, partial: 1, complete: 2 };
    const students = results
      .filter(Boolean)
      .sort((a, b) => statusOrder[a!.activityStatus] - statusOrder[b!.activityStatus]);

    return NextResponse.json({ students, date: targetDate });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}