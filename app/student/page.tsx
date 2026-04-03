// app/student/page.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import LogoutButton from "./LogoutButton";
import GuidanceVideo from "@/components/GuidanceVideo";

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

export default async function StudentHomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;

  if (!token) {
    return (
      <main className="p-10">
        <p>
          Not authenticated.{" "}
          <Link className="underline" href="/student/login">Go to login</Link>
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
    return <main className="p-10"><p>Account not found.</p></main>;
  }

  const dashboardVideoRow = await prisma.pageGuidanceVideo.findUnique({
    where: { pageKey: "dashboard" },
    select: { videoUrl: true },
  });
  const dashboardVideo = dashboardVideoRow?.videoUrl ?? null;

  const today = startOfTodayUtc();
  let todaysTasks: {
    id: string; skill: string; level: string | null;
    isCompleted: boolean; submittedAt: Date | null;
  }[] = [];
  let totalRp = 0;
  let unknownWordCount = 0;

  // Subscription banner state (computed once, used at render time)
  let subscriptionBanner: "renewal_window" | "grace" | "locked" | null = null;
  let subscriptionExpiresAt: Date | null = child.subscriptionExpiresAt ?? null;

  // ── Assessment banner states (active students only) ───────────────────
  let hasPendingInitial       = false; // session created but not yet submitted
  let hasPendingPeriodic      = false; // periodic triggered, not yet submitted
  let hasSubmittedPeriodic    = false; // periodic submitted, awaiting admin review
  let shouldRecommendTomorrow = false; // previous session was submitted today

  // Compute subscription banner for any non-rejected, non-pending student
  if (
    subscriptionExpiresAt !== null &&
    child.status !== "pending_payment" &&
    child.status !== "rejected"
  ) {
    const billingConfig = await prisma.billingConfig.findFirst();
    const gracePeriodDays   = billingConfig?.gracePeriodDays   ?? 7;
    const renewalWindowDays = billingConfig?.renewalWindowDays ?? 7;
    const now = new Date();
    if (now > subscriptionExpiresAt) {
      const hardLockAt = new Date(subscriptionExpiresAt.getTime() + gracePeriodDays * 86_400_000);
      subscriptionBanner = now > hardLockAt ? "locked" : "grace";
    } else {
      const msUntil = subscriptionExpiresAt.getTime() - now.getTime();
      const daysUntil = Math.ceil(msUntil / 86_400_000);
      if (daysUntil <= renewalWindowDays) subscriptionBanner = "renewal_window";
    }
  }

  if (child.status === "active") {
    const [rpAgg, wordCount] = await prisma.$transaction([
      prisma.rpEvent.aggregate({
        where: { childId: child.id },
        _sum:  { delta: true },
      }),
      prisma.unknownWord.count({ where: { childId: child.id } }),
    ]);
    totalRp          = rpAgg._sum.delta ?? 0;
    unknownWordCount = wordCount;

    // Open periodic assessment
    const openPeriodic = await prisma.assessment.findFirst({
      where: { childId: child.id, kind: "periodic", isLatest: true, submittedAt: null },
      select: { id: true },
    });
    hasPendingPeriodic = openPeriodic !== null;

    // Submitted periodic awaiting review
    if (!hasPendingPeriodic) {
      const submittedPeriodic = await prisma.assessment.findFirst({
        where: { childId: child.id, kind: "periodic", isLatest: true, submittedAt: { not: null }, assignedLevel: null },
        select: { id: true },
      });
      hasSubmittedPeriodic = submittedPeriodic !== null;
    }

    // Time-aware label: check if the next pending session was preceded by a
    // submission that happened today (same UTC date).
    // Applies to both initial multi-session flow and periodic.
    const openInitial = await prisma.assessment.findFirst({
      where: { childId: child.id, kind: "initial", isLatest: true, submittedAt: null },
      select: { id: true, sessionNumber: true },
    });
    hasPendingInitial = openInitial !== null;

    const tomorrowStart = new Date(today.getTime() + 86_400_000);

    if (hasPendingInitial && openInitial && openInitial.sessionNumber > 1) {
      const prevSession = await prisma.assessment.findFirst({
        where: { childId: child.id, kind: "initial", sessionNumber: openInitial.sessionNumber - 1 },
        select: { submittedAt: true },
      });
      if (prevSession?.submittedAt) {
        const t = prevSession.submittedAt;
        shouldRecommendTomorrow = t >= today && t < tomorrowStart;
      }
    } else if (hasPendingPeriodic) {
      // Check if there was a previous periodic session submitted today
      const prevPeriodic = await prisma.assessment.findFirst({
        where: { childId: child.id, kind: "periodic", submittedAt: { not: null } },
        orderBy: { submittedAt: "desc" },
        select: { submittedAt: true },
      });
      if (prevPeriodic?.submittedAt) {
        const t = prevPeriodic.submittedAt;
        shouldRecommendTomorrow = t >= today && t < tomorrowStart;
      }
    }
  }

  if (child.status === "pending_level_review") {
    unknownWordCount = await prisma.unknownWord.count({ where: { childId: child.id } });
  }

  // Session counter for assessment_required students
  let initialSessionCount = 1;
  let completedInitialSessions = 0;
  if (child.status === "assessment_required") {
    const assessmentConfig = await prisma.assessmentConfig.findFirst({
      orderBy: { createdAt: "asc" },
      select: { initialSessionCount: true },
    });
    initialSessionCount = assessmentConfig?.initialSessionCount ?? 1;
    completedInitialSessions = await prisma.assessment.count({
      where: { childId: child.id, kind: "initial", submittedAt: { not: null } },
    });
  }

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
        id: true, skill: true, level: true,
        submissions: {
          where: { childId: child.id },
          select: { isCompleted: true, submittedAt: true },
          take: 1,
        },
      },
    });
    todaysTasks = tasks.map((t) => ({
      id: t.id, skill: t.skill, level: t.level,
      isCompleted: t.submissions[0]?.isCompleted ?? false,
      submittedAt: t.submissions[0]?.submittedAt ?? null,
    }));
  }

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Student Dashboard</h1>
        <LogoutButton />
      </div>

      {dashboardVideo && <GuidanceVideo videoUrl={dashboardVideo} />}

      <div className="mt-4 rounded border p-4">
        <p className="font-medium">
          {child.childFirstName} {child.childLastName} (Grade {child.grade})
        </p>
        <p className="text-sm text-gray-700">Username: {child.username}</p>
        <p className="text-sm text-gray-700">Status: {child.status}</p>
        <p className="text-sm text-gray-700">Level: {child.level ?? "Not assigned yet"}</p>
        {child.status === "active" && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1.5">
            <span className="text-sm font-bold text-indigo-700">⭐ {totalRp} RP</span>
            <span className="text-xs text-indigo-500">Reading Points</span>
          </div>
        )}
      </div>

      {/* Subscription banners */}
      {subscriptionBanner === "locked" && (
        <div className="mt-6 rounded border border-red-300 bg-red-50 p-4">
          <p className="font-medium text-red-900">Subscription Expired</p>
          <p className="mt-1 text-sm text-red-800">
            Your subscription has expired and the grace period has ended.
            Submitting work is paused until you renew.
          </p>
          <Link
            className="mt-3 inline-block rounded bg-red-700 px-4 py-2 text-sm text-white"
            href="/student/subscription"
          >
            Renew Now
          </Link>
        </div>
      )}

      {subscriptionBanner === "grace" && (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Subscription Expired</p>
          <p className="mt-1 text-sm text-amber-800">
            Your subscription expired on{" "}
            {subscriptionExpiresAt!.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.
            Please renew to avoid losing access.
          </p>
          <Link
            className="mt-3 inline-block rounded bg-amber-600 px-4 py-2 text-sm text-white"
            href="/student/subscription"
          >
            Renew Subscription
          </Link>
        </div>
      )}

      {subscriptionBanner === "renewal_window" && (
        <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Subscription Renewal Available</p>
          <p className="mt-1 text-sm text-amber-800">
            Your subscription expires on{" "}
            {subscriptionExpiresAt!.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.
            You can submit your renewal payment now.
          </p>
          <Link
            className="mt-3 inline-block rounded bg-amber-600 px-4 py-2 text-sm text-white"
            href="/student/subscription"
          >
            View Subscription
          </Link>
        </div>
      )}

      {/* Initial assessment required */}
      {child.status === "assessment_required" && (
        <div className="mt-6 rounded border p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="font-medium">Initial Assessment Required</p>
            {initialSessionCount > 1 && (
              <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs text-gray-600 shrink-0">
                Session {completedInitialSessions + 1} of {initialSessionCount}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-700">
            {completedInitialSessions === 0
              ? `Complete ${initialSessionCount > 1 ? `all ${initialSessionCount} assessment sessions` : "the initial assessment"} so the admin can assign your level.`
              : `You've completed ${completedInitialSessions} of ${initialSessionCount} sessions. Continue when you're ready.`}
          </p>
          <Link className="mt-3 inline-block rounded bg-black px-4 py-2 text-white" href="/student/assessment">
            {completedInitialSessions === 0 ? "Start Assessment" : "Continue Assessment"}
          </Link>
        </div>
      )}

      {/* Pending level review */}
      {child.status === "pending_level_review" && (
        <div className="mt-6 rounded border p-4">
          <p className="font-medium">Admin is assessing your level</p>
          <p className="mt-1 text-sm text-gray-700">
            You already submitted your assessment. Please wait for the admin to assign your level.
          </p>
        </div>
      )}

      {/* Active: pending next initial session (multi-session flow) */}
      {child.status === "active" && hasPendingInitial && (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Next Assessment Session Ready</p>
          <p className="mt-1 text-sm text-amber-800">
            Your next assessment session is available. Complete it to finish your placement.
          </p>
          {shouldRecommendTomorrow && (
            <p className="mt-2 text-sm text-amber-700 font-medium">
              📅 We recommend completing this tomorrow for your best results.
              A fresh start on a different day gives a more accurate picture of your abilities.
            </p>
          )}
          <Link
            className="mt-3 inline-block rounded bg-amber-600 px-4 py-2 text-sm text-white"
            href="/student/assessment"
          >
            Continue Assessment
          </Link>
        </div>
      )}

      {/* Active: pending periodic re-evaluation */}
      {child.status === "active" && hasPendingPeriodic && (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Re-evaluation Required</p>
          <p className="mt-1 text-sm text-amber-800">
            Your teacher has requested a new assessment to review your progress.
          </p>
          {shouldRecommendTomorrow && (
            <p className="mt-2 text-sm text-amber-700 font-medium">
              📅 We recommend completing this tomorrow for your best results.
            </p>
          )}
          <Link
            className="mt-3 inline-block rounded bg-amber-600 px-4 py-2 text-sm text-white"
            href="/student/assessment"
          >
            Start Re-evaluation
          </Link>
        </div>
      )}

      {/* Active: submitted periodic, awaiting admin review */}
      {child.status === "active" && hasSubmittedPeriodic && (
        <div className="mt-6 rounded border border-blue-200 bg-blue-50 p-4">
          <p className="font-medium text-blue-900">Re-evaluation Submitted</p>
          <p className="mt-1 text-sm text-blue-800">
            Your re-evaluation has been submitted. Your teacher will review it shortly.
          </p>
        </div>
      )}

      {/* Subscription */}
      {child.status !== "pending_payment" && child.status !== "rejected" && (
        <div className="mt-6 rounded border p-4">
          <p className="font-medium">My Subscription</p>
          <p className="mt-1 text-sm text-gray-700">
            {subscriptionExpiresAt
              ? `Active until ${subscriptionExpiresAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`
              : "Subscription details are managed by your admin."}
          </p>
          <Link
            className="mt-3 inline-block rounded bg-black px-4 py-2 text-sm text-white"
            href="/student/subscription"
          >
            View Subscription
          </Link>
        </div>
      )}

      {/* Profile */}
      <div className="mt-6 rounded border p-4">
        <p className="font-medium">My Profile</p>
        <p className="mt-1 text-sm text-gray-700">
          View your profile information or request changes to your name, grade, or contact details.
        </p>
        <Link
          className="mt-3 inline-block rounded bg-black px-4 py-2 text-sm text-white"
          href="/student/profile"
        >
          View / Update Profile
        </Link>
      </div>

      {/* Unknown word list */}
      {(child.status === "active" || child.status === "pending_level_review") && (
        <div className="mt-6 rounded border p-4">
          <p className="font-medium">My Unknown Words</p>
          <p className="mt-1 text-sm text-gray-700">
            {unknownWordCount === 0
              ? "You haven't saved any unknown words yet."
              : `You have ${unknownWordCount} word${unknownWordCount !== 1 ? "s" : ""} saved.`}
          </p>
          <Link
            className="mt-3 inline-block rounded bg-black px-4 py-2 text-sm text-white"
            href="/student/words"
          >
            View Word List
          </Link>
        </div>
      )}

      {/* Daily tasks */}
      {child.status === "active" && (
        <div className="mt-6 rounded border p-4">
          <p className="font-medium">Today&apos;s Tasks</p>
          {todaysTasks.length === 0 ? (
            <p className="mt-1 text-sm text-gray-700">No tasks posted for today.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {todaysTasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded border p-3">
                  <div>
                    <p className="font-medium capitalize">{t.skill}</p>
                    <p className="text-xs text-gray-600">
                      {t.isCompleted
                        ? "Completed ✅"
                        : t.submittedAt
                        ? "Submitted — retry questions available"
                        : "Not completed yet"}
                    </p>
                  </div>
                  {t.isCompleted ? (
                    <span className="text-sm text-gray-600">Locked</span>
                  ) : (
                    <Link className="rounded bg-black px-3 py-1 text-sm text-white" href={`/student/tasks/${t.id}`}>
                      {t.submittedAt ? "Continue" : "Start"}
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