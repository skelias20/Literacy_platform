// app/admin/inactive-students/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type SkillType = "reading" | "listening" | "writing" | "speaking";

type SkillBreakdown = {
  skill: SkillType;
  isCompleted: boolean;
  submittedAt: string | null;
};

type StudentActivity = {
  id: string;
  childFirstName: string;
  childLastName: string;
  level: string | null;
  lastDailySubmissionAt: string | null;
  parent: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  totalTasks: number;
  completedTasks: number;
  activityStatus: "none" | "partial" | "complete";
  skillBreakdown: SkillBreakdown[];
};

function yyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Never submitted";
  const d = new Date(iso);
  const now = new Date();
  const diffH = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60));
  if (diffH < 1) return "Less than 1 hour ago";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} day${diffD > 1 ? "s" : ""} ago`;
}

const STATUS_CONFIG = {
  none: {
    label: "No activity",
    badge: "bg-red-100 text-red-700",
    icon: "❌",
  },
  partial: {
    label: "Partial",
    badge: "bg-yellow-100 text-yellow-700",
    icon: "⚠️",
  },
  complete: {
    label: "Complete",
    badge: "bg-green-100 text-green-700",
    icon: "✅",
  },
};

export default function InactiveStudentsPage() {
  const [date, setDate] = useState<string>(() => yyyyMmDd(new Date()));
  const [students, setStudents] = useState<StudentActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filter state
  const [filter, setFilter] = useState<"all" | "none" | "partial" | "complete">("all");

  async function load() {
    setLoading(true);
    setErr(null);

    const res = await fetch(`/api/admin/inactive-students?date=${date}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErr(data.error ?? "Failed to load.");
      setLoading(false);
      return;
    }

    setStudents(data.students ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const filtered =
    filter === "all" ? students : students.filter((s) => s.activityStatus === filter);

  const counts = {
    none: students.filter((s) => s.activityStatus === "none").length,
    partial: students.filter((s) => s.activityStatus === "partial").length,
    complete: students.filter((s) => s.activityStatus === "complete").length,
  };

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Student Activity Monitor</h1>
          <p className="mt-1 text-sm text-gray-600">
            Track daily task completion per student. Contact parents of inactive students.
          </p>
        </div>
        <Link className="underline" href="/admin">
          Back to admin dashboard
        </Link>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      {/* Date picker */}
      <div className="mt-6 flex items-center gap-3">
        <label className="text-sm font-medium">Date</label>
        <input
          type="date"
          className="rounded border px-3 py-1.5 text-sm"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {loading && <span className="text-sm text-gray-500">Loading...</span>}
      </div>

      {/* Summary counters */}
      {!loading && students.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {(["all", "none", "partial", "complete"] as const).map((key) => {
            const count = key === "all" ? students.length : counts[key];
            const config = key === "all"
              ? { label: "All students", badge: "bg-gray-100 text-gray-700", icon: "👥" }
              : STATUS_CONFIG[key];
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all
                  ${filter === key ? "ring-2 ring-black" : "opacity-70 hover:opacity-100"}
                  ${config.badge}`}
              >
                {config.icon} {config.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Student list */}
      <div className="mt-6 space-y-3">
        {!loading && filtered.length === 0 && (
          <p className="text-sm text-gray-600">
            {students.length === 0
              ? "No tasks were assigned on this date, or no active students."
              : "No students match this filter."}
          </p>
        )}

        {filtered.map((student) => {
          const config = STATUS_CONFIG[student.activityStatus];
          const isExpanded = expandedId === student.id;

          return (
            <div key={student.id} className="rounded border">
              {/* Row header */}
              <div
                className="flex cursor-pointer items-center justify-between p-4"
                onClick={() => setExpandedId(isExpanded ? null : student.id)}
              >
                <div className="flex items-center gap-4">
                  <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${config.badge}`}>
                    {config.icon} {config.label}
                  </span>
                  <div>
                    <p className="font-medium">
                      {student.childFirstName} {student.childLastName}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">
                      Level: {student.level ?? "unassigned"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-sm text-gray-600">
                  <span>
                    {student.completedTasks} / {student.totalTasks} tasks
                  </span>
                  <span className="text-xs text-gray-400">
                    Last seen: {formatLastSeen(student.lastDailySubmissionAt)}
                  </span>
                  <span className="text-gray-400">{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t bg-gray-50 px-4 py-4">
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* Skill breakdown */}
                    <div>
                      <p className="text-sm font-semibold">Task Breakdown</p>
                      <div className="mt-2 space-y-2">
                        {student.skillBreakdown.map((s) => (
                          <div
                            key={s.skill}
                            className="flex items-center justify-between rounded border bg-white px-3 py-2 text-sm"
                          >
                            <span className="capitalize font-medium">{s.skill}</span>
                            <div className="flex items-center gap-3">
                              {s.isCompleted ? (
                                <>
                                  <span className="text-xs text-gray-500">
                                    Submitted at {formatTime(s.submittedAt)}
                                  </span>
                                  <span className="text-green-600">✅ Done</span>
                                </>
                              ) : (
                                <span className="text-red-500">❌ Not done</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Parent contact */}
                    <div>
                      <p className="text-sm font-semibold">Parent Contact</p>
                      <div className="mt-2 rounded border bg-white p-3 text-sm space-y-1">
                        <p className="font-medium">
                          {student.parent.firstName} {student.parent.lastName}
                        </p>
                        <p className="text-gray-600">📧 {student.parent.email}</p>
                        <p className="text-gray-600">📞 {student.parent.phone}</p>
                      </div>

                      {student.activityStatus !== "complete" && (
                        <div className="mt-3 rounded border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
                          <p className="font-semibold">Suggested action</p>
                          <p className="mt-1">
                            {student.activityStatus === "none"
                              ? "Student has not started any tasks today. Consider contacting the parent."
                              : `Student completed ${student.completedTasks} of ${student.totalTasks} tasks. A reminder may help.`}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}