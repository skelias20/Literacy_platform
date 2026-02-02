// app/student/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function startOfTodayUtc(): Date {
  const now = new Date();
  // we store taskDate as 00:00Z in your app layer; match that.
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}

export default async function StudentHomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;

  if (!token) {
    return (
      <main className="p-10">
        <p>
          Not authenticated.{" "}
          <Link className="underline" href="/student/login">
            Go to login
          </Link>
        </p>
      </main>
    );
  }

  const payload = verifyStudentJwt(token);

  const child = await prisma.child.findUnique({
    where: { id: payload.childId },
    include: { parent: true },
  });

  if (!child) {
    return (
      <main className="p-10">
        <p>Account not found.</p>
      </main>
    );
  }

  // ---- Load today's tasks only if active ----
  const today = startOfTodayUtc();
  let todaysTasks: {
    id: string;
    skill: string;
    level: string | null;
    isCompleted: boolean;
    submittedAt: Date | null;
  }[] = [];

  if (child.status === "active") {
    const tasks = await prisma.dailyTask.findMany({
      where: {
        taskDate: today,
        OR: [
          { level: null },
          child.level ? { level: child.level } : { level: null },
        ],
      },
      orderBy: [{ skill: "asc" }],
      select: {
        id: true,
        skill: true,
        level: true,
        submissions: {
          where: { childId: child.id },
          select: { isCompleted: true, submittedAt: true },
          take: 1,
        },
      },
    });

    todaysTasks = tasks.map((t) => ({
      id: t.id,
      skill: t.skill,
      level: t.level,
      isCompleted: t.submissions[0]?.isCompleted ?? false,
      submittedAt: t.submissions[0]?.submittedAt ?? null,
    }));
  }

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Student Dashboard</h1>

      <div className="mt-4 rounded border p-4">
        <p className="font-medium">
          {child.childFirstName} {child.childLastName} (Grade {child.grade})
        </p>
        <p className="text-sm text-gray-700">Username: {child.username}</p>
        <p className="text-sm text-gray-700">Status: {child.status}</p>
        <p className="text-sm text-gray-700">
          Level: {child.level ?? "Not assigned yet"}
        </p>
      </div>

      {child.status === "assessment_required" && (
        <div className="mt-6 rounded border p-4">
          <p className="font-medium">Initial Assessment Required</p>
          <p className="mt-1 text-sm text-gray-700">
            Complete the initial assessment so the admin can assign your level.
          </p>
          <Link
            className="mt-3 inline-block rounded bg-black px-4 py-2 text-white"
            href="/student/assessment"
          >
            Start Initial Assessment
          </Link>
        </div>
      )}

      {child.status === "pending_level_review" && (
        <div className="mt-6 rounded border p-4">
          <p className="font-medium">Admin is assessing your level</p>
          <p className="mt-1 text-sm text-gray-700">
            You already submitted your initial assessment. Please wait for the
            admin to assign your level. If you log out and log back in, you will
            still see this page until your level is assigned.
          </p>
        </div>
      )}

      {child.status === "active" && (
        <div className="mt-6 rounded border p-4">
          <p className="font-medium">Today’s Tasks</p>

          {todaysTasks.length === 0 ? (
            <p className="mt-1 text-sm text-gray-700">
              No tasks posted for today.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {todaysTasks.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded border p-3"
                >
                  <div>
                    <p className="font-medium capitalize">{t.skill}</p>
                    <p className="text-xs text-gray-600">
                      {t.isCompleted
                        ? "Completed ✅"
                        : "Not completed yet"}
                    </p>
                  </div>

                  {t.isCompleted ? (
                    <span className="text-sm text-gray-600">Locked</span>
                  ) : (
                    <Link
                      className="rounded bg-black px-3 py-1 text-sm text-white"
                      href={`/student/tasks/${t.id}`}
                    >
                      Start
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
