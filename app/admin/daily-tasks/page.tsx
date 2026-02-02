// app/admin/daily-tasks/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SkillType = "reading" | "listening" | "writing" | "speaking";
type LiteracyLevel = "foundational" | "functional" | "transitional" | "advanced";

type ContentItem = {
  id: string;
  title: string;
  description: string | null;
  skill: SkillType;
  type: string;
  level: LiteracyLevel | null;
};

type Task = {
  id: string;
  taskDate: string;
  skill: SkillType;
  level: LiteracyLevel | null;
  contentLinks: { contentItemId: string; contentItem: { id: string; title: string; skill: SkillType } }[];
};

const SKILLS: SkillType[] = ["reading", "listening", "writing", "speaking"];
const LEVELS: LiteracyLevel[] = ["foundational", "functional", "transitional", "advanced"];

function yyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AdminDailyTasksPage() {
  const [date, setDate] = useState<string>(() => yyyyMmDd(new Date()));
  const [level, setLevel] = useState<"all" | LiteracyLevel>("all");

  const [content, setContent] = useState<ContentItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const [selectedSkills, setSelectedSkills] = useState<SkillType[]>([]);
  const [contentBySkill, setContentBySkill] = useState<Record<SkillType, string[]>>({
    reading: [],
    listening: [],
    writing: [],
    speaking: [],
  });

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    setMsg(null);

    const qs = new URLSearchParams({ date, level });
    const res = await fetch(`/api/admin/daily-tasks?${qs.toString()}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErr(data.error ?? "Failed to load.");
      setLoading(false);
      return;
    }

    setContent(data.content ?? []);
    setTasks(data.tasks ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, level]);

  const contentBySkillView = useMemo(() => {
    const map: Record<SkillType, ContentItem[]> = {
      reading: [],
      listening: [],
      writing: [],
      speaking: [],
    };
    for (const c of content) map[c.skill].push(c);
    return map;
  }, [content]);

  function toggleSkill(skill: SkillType) {
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]
    );
  }

  function toggleContent(skill: SkillType, contentId: string) {
    setContentBySkill((prev) => {
      const current = prev[skill];
      const next = current.includes(contentId)
        ? current.filter((id) => id !== contentId)
        : [...current, contentId];
      return { ...prev, [skill]: next };
    });
  }

  async function save() {
    setErr(null);
    setMsg(null);

    if (selectedSkills.length === 0) {
      setErr("Pick at least one skill.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/admin/daily-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        level,
        skills: selectedSkills,
        contentBySkill,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Save failed.");
      setLoading(false);
      return;
    }

    setMsg("Daily tasks saved.");
    await load();
    setLoading(false);
  }

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Create Daily Tasks</h1>
          <p className="mt-1 text-sm text-gray-600">
            Create one task per selected skill for the chosen date.
          </p>
        </div>
        <Link className="underline" href="/admin">
          Back to admin dashboard
        </Link>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {msg && <p className="mt-3 text-sm text-green-700">{msg}</p>}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded border p-4">
          <h2 className="text-lg font-semibold">Settings</h2>

          <div className="mt-3 flex flex-col gap-3">
            <label className="text-sm">
              <span className="block font-medium">Date</span>
              <input
                className="mt-1 w-full rounded border p-2 text-sm"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            <label className="text-sm">
              <span className="block font-medium">Level</span>
              <select
                className="mt-1 w-full rounded border p-2 text-sm"
                value={level}
                onChange={(e) => setLevel(e.target.value as "all" | LiteracyLevel)}
              >
                <option value="all">All levels</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-sm">
              <span className="block font-medium">Skills</span>
              <div className="mt-2 flex flex-wrap gap-3">
                {SKILLS.map((s) => (
                  <label key={s} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedSkills.includes(s)}
                      onChange={() => toggleSkill(s)}
                    />
                    <span className="capitalize">{s}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={save}
              disabled={loading}
              className="mt-2 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {loading ? "Saving..." : "Save daily tasks"}
            </button>
          </div>
        </section>

        <section className="rounded border p-4">
          <h2 className="text-lg font-semibold">Existing tasks for this date</h2>
          {loading && <p className="mt-2 text-sm text-gray-600">Loading...</p>}

          {tasks.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">No tasks created yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {tasks.map((t) => (
                <div key={t.id} className="rounded border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{t.skill}</span>
                    <span className="text-gray-600">{t.level ?? "all levels"}</span>
                  </div>
                  <ul className="mt-2 list-disc pl-5 text-gray-700">
                    {t.contentLinks.map((cl) => (
                      <li key={cl.contentItemId}>{cl.contentItem.title}</li>
                    ))}
                    {t.contentLinks.length === 0 && <li>No content attached</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-6 rounded border p-4">
        <h2 className="text-lg font-semibold">Attach content (per skill)</h2>
        <p className="mt-1 text-sm text-gray-600">
          Only affects skills you checked above. For the demo, attach at least 1 item per skill.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {SKILLS.map((s) => {
            const enabled = selectedSkills.includes(s);
            const list = contentBySkillView[s];

            return (
              <div key={s} className={`rounded border p-3 ${!enabled ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-medium capitalize">{s}</h3>
                  {!enabled && <span className="text-xs text-gray-600">not selected</span>}
                </div>

                {list.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-600">No content items for this skill.</p>
                ) : (
                  <div className="mt-2 max-h-56 space-y-2 overflow-auto text-sm">
                    {list.map((c) => (
                      <label key={c.id} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          disabled={!enabled}
                          checked={contentBySkill[s].includes(c.id)}
                          onChange={() => toggleContent(s, c.id)}
                        />
                        <span>
                          <span className="font-medium">{c.title}</span>
                          <span className="block text-xs text-gray-600">
                            {c.level ?? "any level"} • {c.type}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
