"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SkillType = "reading" | "listening" | "writing" | "speaking";
type LiteracyLevel = "foundational" | "functional" | "transitional" | "advanced" | null;

type Artifact = {
  id: string;
  skill: SkillType;
  textBody: string | null;
  fileId: string | null;
  createdAt: string;
};

type StudentRow = {
  child: {
    id: string;
    childFirstName: string;
    childLastName: string;
    username: string | null;
    status: string;
    level: LiteracyLevel;
  };
  submission: null | {
    id: string;
    submittedAt: string | null;
    isCompleted: boolean;
    rpEarned: number;
    artifacts: Artifact[];
  };
};

type TaskBlock = {
  task: {
    id: string;
    taskDate: string;
    skill: SkillType;
    level: LiteracyLevel;
    createdAt: string;
  };
  content: Array<{
    id: string;
    title: string;
    description: string | null;
    skill: SkillType;
    type: string;
    level: LiteracyLevel;
    assetUrl: string | null;
    mimeType: string | null;
  }>;
  students: StudentRow[];
};

function todayDateInputValue(): string {
  // client-side local date
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function AdminDailyReviewsPage() {
  const [date, setDate] = useState<string>(todayDateInputValue());
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskBlock[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/daily-reviews?date=${encodeURIComponent(date)}`);
      const data = (await res.json()) as { error?: string; tasks?: TaskBlock[] };

      if (!res.ok) {
        setErr(data.error ?? "Failed to load.");
        setTasks([]);
        setLoading(false);
        return;
      }

      setTasks(data.tasks ?? []);
      setLoading(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load.";
      setErr(msg);
      setTasks([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const summary = useMemo(() => {
    let total = 0;
    let completed = 0;
    for (const t of tasks) {
      for (const s of t.students) {
        total += 1;
        if (s.submission?.isCompleted) completed += 1;
      }
    }
    return { total, completed };
  }, [tasks]);

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Review Daily Submissions</h1>
        <Link className="underline" href="/admin">
          Back to dashboard
        </Link>
      </div>

      <div className="mt-4 flex items-end gap-4">
        <div>
          <label className="block text-sm font-medium">Date</label>
          <input
            className="mt-1 rounded border px-3 py-2 text-sm"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="text-sm text-gray-700">
          Completed: <span className="font-medium">{summary.completed}</span> /{" "}
          <span className="font-medium">{summary.total}</span>
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {loading && <p className="mt-6">Loading...</p>}

      {!loading && !err && tasks.length === 0 && (
        <p className="mt-6 text-sm text-gray-700">No daily tasks found for this date.</p>
      )}

      <div className="mt-6 space-y-6">
        {tasks.map((block) => (
          <section key={block.task.id} className="rounded border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-lg font-semibold capitalize">{block.task.skill} task</p>
                <p className="text-sm text-gray-700">
                  Level: {block.task.level ?? "all"} • Task ID: {block.task.id}
                </p>
              </div>
            </div>

            <div className="mt-3">
              <p className="text-sm font-medium">Assigned content</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-gray-800">
                {block.content.map((c) => (
                  <li key={c.id}>
                    {c.title} <span className="text-gray-500">({c.type})</span>{" "}
                    {c.assetUrl ? (
                      <>
                        —{" "}
                        <a className="underline" href={c.assetUrl} target="_blank" rel="noreferrer">
                          open
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium">Students</p>
              <div className="mt-2 space-y-3">
                {block.students.map((row) => {
                  const fullName = `${row.child.childFirstName} ${row.child.childLastName}`;
                  const done = row.submission?.isCompleted === true;

                  return (
                    <div key={row.child.id} className="rounded border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">
                            {fullName}{" "}
                            <span className="text-gray-500">
                              ({row.child.username ?? "no username"})
                            </span>
                          </p>
                          <p className="text-xs text-gray-600">
                            status: {row.child.status} • level: {row.child.level ?? "n/a"}
                          </p>
                        </div>

                        <div className="text-sm">
                          {done ? (
                            <span className="rounded bg-green-100 px-2 py-1 text-green-800">
                              Completed ✅
                            </span>
                          ) : (
                            <span className="rounded bg-gray-100 px-2 py-1 text-gray-800">
                              Not submitted ❌
                            </span>
                          )}
                        </div>
                      </div>

                      {row.submission && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs text-gray-600">
                            submittedAt: {row.submission.submittedAt ?? "—"} • rp:{" "}
                            {row.submission.rpEarned}
                          </p>

                          {row.submission.artifacts.length === 0 ? (
                            <p className="text-sm text-gray-700">No artifacts attached.</p>
                          ) : (
                            <div className="space-y-2">
                              {row.submission.artifacts.map((a) => (
                                <div key={a.id} className="rounded bg-gray-50 p-2 text-sm">
                                  <p className="font-medium capitalize">{a.skill} artifact</p>

                                  {a.textBody ? (
                                    <pre className="mt-1 whitespace-pre-wrap text-xs">
                                      {a.textBody}
                                    </pre>
                                  ) : null}

                                  {a.fileId ? (
                                    <div className="mt-1">
                                      <a
                                        className="underline"
                                        href={`/api/admin/files/${a.fileId}`}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Open / download file
                                      </a>
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
