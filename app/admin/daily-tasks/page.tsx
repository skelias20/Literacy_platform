// app/admin/daily-tasks/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/fetchWithAuth";

type SkillType    = "reading" | "listening" | "writing" | "speaking";
type LiteracyLevel = "foundational" | "functional" | "transitional" | "advanced";
type TaskFormat   = "free_response" | "mcq" | "msaq" | "fill_blank";

type ContentItem = {
  id: string; title: string; description: string | null;
  skill: SkillType; type: string; level: LiteracyLevel | null;
};
type Task = {
  id: string; taskDate: string; skill: SkillType; level: LiteracyLevel | null;
  rpValue: number; taskFormat: TaskFormat;
  writingMinWords: number | null; writingMaxWords: number | null;
  contentLinks: { contentItemId: string; contentItem: { id: string; title: string; skill: SkillType } }[];
};

// ── Question bank types ───────────────────────────────────────────────────
type McqQ  = { id: string; type: "mcq";        prompt: string; options: string[];   correctAnswer: string };
type MsaqQ = { id: string; type: "msaq";       prompt: string; answerCount: number; correctAnswers: string[] };
type FillQ = { id: string; type: "fill_blank"; prompt: string;                      correctAnswer: string };
type AnyQ  = McqQ | MsaqQ | FillQ;

const SKILLS: SkillType[]     = ["reading", "listening", "writing", "speaking"];
const LEVELS: LiteracyLevel[] = ["foundational", "functional", "transitional", "advanced"];

const FORMAT_LABELS: Record<TaskFormat, string> = {
  free_response: "Free response (write freely)",
  mcq:           "Multiple choice (one correct answer)",
  msaq:          "Multiple short answer (typed answers)",
  fill_blank:    "Fill in the blank",
};

function yyyyMmDd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newQuestionId() { return `q${Date.now()}`; }

export default function AdminDailyTasksPage() {
  const [date, setDate]   = useState(() => yyyyMmDd(new Date()));
  const [level, setLevel] = useState<"all" | LiteracyLevel>("all");

  const [content, setContent] = useState<ContentItem[]>([]);
  const [tasks, setTasks]     = useState<Task[]>([]);

  const [selectedSkills, setSelectedSkills]     = useState<SkillType[]>([]);
  const [rpValue, setRpValue]                   = useState(10);
  const [contentBySkill, setContentBySkill]     = useState<Record<SkillType, string[]>>({ reading: [], listening: [], writing: [], speaking: [] });

  // Listening format
  const [taskFormat, setTaskFormat]   = useState<TaskFormat>("mcq");
  const [questions, setQuestions]     = useState<AnyQ[]>([]);

  // Question bank state — tracks what was loaded from the server for the selected audio.
  // Used to determine whether the admin has made edits that haven't been saved back.
  const [loadedQuestions, setLoadedQuestions]       = useState<AnyQ[]>([]);
  const [selectedAudioId, setSelectedAudioId]       = useState<string | null>(null);
  const [qbLoading, setQbLoading]                   = useState(false);
  const [qbSaving, setQbSaving]                     = useState(false);
  const [qbMsg, setQbMsg]                           = useState<string | null>(null);

  // Whether current questions differ from what was loaded from the server.
  // Computed by comparing JSON — stable enough for this use case.
  const qbIsDirty = useMemo(() => {
    return JSON.stringify(questions) !== JSON.stringify(loadedQuestions);
  }, [questions, loadedQuestions]);

  // Fetch question bank when a listening audio is selected
  async function onAudioSelected(audioId: string) {
    setSelectedAudioId(audioId);
    setQbMsg(null);

    if (taskFormat === "free_response") return; // no question bank for free response

    setQbLoading(true);
    const res  = await adminFetch(`/api/admin/content/${audioId}/question-bank`);
    const data = await res.json().catch(() => ({}));
    setQbLoading(false);

    if (!res.ok) {
      setErr(data.error ?? "Failed to load question bank.");
      return;
    }

    if (data.questionBank?.questions) {
      const qs = data.questionBank.questions as AnyQ[];
      setQuestions(qs);
      setLoadedQuestions(qs);
    } else {
      // No existing bank — start with empty builder
      setQuestions([]);
      setLoadedQuestions([]);
    }
  }

  // Save question bank back to the audio content item (independent of task creation)
  async function saveQuestionBank() {
    if (!selectedAudioId || questions.length === 0) return;

    // Client-side validation before calling the server
    for (const q of questions) {
      if (!q.prompt.trim()) { setErr("All questions must have a prompt."); return; }
      if (q.type === "mcq") {
        if (!(q as McqQ).options.every((o) => o.trim())) { setErr("All MCQ options must be filled in."); return; }
        if (!(q as McqQ).correctAnswer.trim()) { setErr("All MCQ questions must have a correct answer selected."); return; }
        if (!(q as McqQ).options.includes((q as McqQ).correctAnswer)) { setErr("MCQ correct answer must match one of the options."); return; }
      }
      if (q.type === "msaq") {
        if (!(q as MsaqQ).correctAnswers.every((a) => a.trim())) { setErr("All MSAQ correct answers must be filled in."); return; }
      }
      if (q.type === "fill_blank") {
        if (!(q as FillQ).correctAnswer.trim()) { setErr("All fill-in-the-blank questions need a correct answer."); return; }
      }
    }

    setQbSaving(true); setErr(null); setQbMsg(null);
    const res  = await adminFetch(`/api/admin/content/${selectedAudioId}/question-bank`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskFormat, questions }),
    });
    const data = await res.json().catch(() => ({}));
    setQbSaving(false);

    if (!res.ok) { setErr(data.error ?? "Failed to save question bank."); return; }

    // Mark as clean — loaded state now matches current state
    setLoadedQuestions([...questions]);
    setQbMsg(data.action === "created" ? "Question bank created and saved to this audio." : "Question bank updated successfully.");
  }

  // Writing constraints
  const [writingMinWords, setWritingMinWords] = useState<string>("");
  const [writingMaxWords, setWritingMaxWords] = useState<string>("");

  const [loading, setLoading]           = useState(false);
  const [err, setErr]                   = useState<string | null>(null);
  const [msg, setMsg]                   = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true); setErr(null); setMsg(null);
    const qs = new URLSearchParams({ date, level });
    const res = await adminFetch(`/api/admin/daily-tasks?${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error ?? "Failed to load."); setLoading(false); return; }
    setContent(data.content ?? []);
    setTasks(data.tasks ?? []);
    setLoading(false);
  }

  useEffect(() => {
    let isCancelled = false;
    const run = async () => {
      setLoading(true); setErr(null); setMsg(null);
      try {
        const qs = new URLSearchParams({ date, level });
        const res = await adminFetch(`/api/admin/daily-tasks?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (isCancelled) return;
        if (!res.ok) { setErr(data.error ?? "Failed to load."); }
        else { setContent(data.content ?? []); setTasks(data.tasks ?? []); }
      } catch { if (!isCancelled) setErr("Network error."); }
      finally { if (!isCancelled) setLoading(false); }
    };
    void run();
    return () => { isCancelled = true; };
  }, [date, level]);

  const contentBySkillView = useMemo(() => {
    const map: Record<SkillType, ContentItem[]> = { reading: [], listening: [], writing: [], speaking: [] };
    for (const c of content) map[c.skill].push(c);
    return map;
  }, [content]);

  function toggleSkill(s: SkillType) {
    setSelectedSkills((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]);
  }
  function toggleContent(s: SkillType, id: string) {
    setContentBySkill((p) => ({ ...p, [s]: [id] }));
    // When a listening audio is selected, fetch its question bank
    if (s === "listening") {
      void onAudioSelected(id);
    }
  }

  // ── Question builder helpers ──────────────────────────────────────────
  function addQuestion(type: AnyQ["type"]) {
    const id = newQuestionId();
    if (type === "mcq") setQuestions((p) => [...p, { id, type, prompt: "", options: ["", "", "", ""], correctAnswer: "" }]);
    else if (type === "msaq") setQuestions((p) => [...p, { id, type, prompt: "", answerCount: 2, correctAnswers: ["", ""] }]);
    else setQuestions((p) => [...p, { id, type: "fill_blank", prompt: "", correctAnswer: "" }]);
  }
  function removeQuestion(id: string) { setQuestions((p) => p.filter((q) => q.id !== id)); }
  function updateQuestion(id: string, patch: Partial<AnyQ>) {
    setQuestions((p) => p.map((q) => q.id === id ? { ...q, ...patch } as AnyQ : q));
  }

  // ── Save ──────────────────────────────────────────────────────────────
  async function save() {
    setErr(null); setMsg(null);
    if (selectedSkills.length === 0) { setErr("Pick at least one skill."); return; }

    const missing = selectedSkills.filter((s) => (contentBySkill[s] ?? []).length === 0);
    if (missing.length > 0) { setErr(`Attach at least one content item for: ${missing.join(", ")}.`); return; }

    // Validate question bank if structured listening is selected
    if (selectedSkills.includes("listening") && taskFormat !== "free_response") {
      if (questions.length === 0) { setErr("Add at least one question for the structured listening task."); return; }
      for (const q of questions) {
        if (!q.prompt.trim()) { setErr("All questions must have a prompt."); return; }
        if (q.type === "mcq") {
          if (!(q as McqQ).options.every((o) => o.trim())) { setErr("All MCQ options must be filled in."); return; }
          if (!(q as McqQ).correctAnswer.trim()) { setErr("All MCQ questions must have a correct answer selected."); return; }
        }
        if (q.type === "msaq") {
          if (!(q as MsaqQ).correctAnswers.every((a) => a.trim())) { setErr("All MSAQ correct answers must be filled in."); return; }
        }
        if (q.type === "fill_blank") {
          if (!(q as FillQ).correctAnswer.trim()) { setErr("All fill-in-the-blank questions need a correct answer."); return; }
        }
      }
    }

    // Validate word count range
    const minW = writingMinWords ? parseInt(writingMinWords) : null;
    const maxW = writingMaxWords ? parseInt(writingMaxWords) : null;
    if (minW !== null && maxW !== null && minW >= maxW) { setErr("Minimum word count must be less than maximum."); return; }

    // Embed question bank JSON into the listening content item's textBody
    // We send it as a special field — the route stores it on the task, not the content item
    // Actually: question bank is a separate concept from content items.
    // We store it by updating the contentItem textBody via a separate mechanism.
    // For now: we pass it as questionBank in the POST body for the route to handle.

    setLoading(true);
    const res = await adminFetch("/api/admin/daily-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date, level, skills: selectedSkills, contentBySkill, rpValue,
        taskFormat: selectedSkills.includes("listening") ? taskFormat : "free_response",
        writingMinWords: minW,
        writingMaxWords: maxW,
        questionBank: taskFormat !== "free_response" && selectedSkills.includes("listening") && questions.length > 0
          ? { questions }
          : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error ?? "Save failed."); setLoading(false); return; }

    // Warn if the question bank was edited but not saved back to the audio
    if (qbIsDirty && selectedAudioId && taskFormat !== "free_response") {
      setMsg("Daily task saved. ⚠ Question bank changes were not saved to the audio — future tasks using this audio will use the previous questions. Click \"Save question bank\" to update it.");
    } else {
      setMsg("Daily tasks saved.");
    }
    await load();
    setLoading(false);
  }

  // ── Delete task ──────────────────────────────────────────────────────
  async function deleteTask(taskId: string) {
    setDeletingTaskId(taskId); setErr(null); setMsg(null);
    const res  = await adminFetch(`/api/admin/daily-tasks/${taskId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setDeletingTaskId(null);
    setDeleteConfirmId(null);
    if (!res.ok) { setErr(data.error ?? "Delete failed."); return; }
    setMsg("Task deleted.");
    await load();
  }

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Create Daily Tasks</h1>
          <p className="mt-1 text-sm text-gray-600">Create one task per selected skill for the chosen date.</p>
        </div>
        <Link className="underline" href="/admin">Back to admin dashboard</Link>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {msg && <p className="mt-3 text-sm text-green-700">{msg}</p>}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {/* Settings panel */}
        <section className="rounded border p-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <div className="mt-3 flex flex-col gap-3">
            <label className="text-sm"><span className="block font-medium">Date</span>
              <input
                className="mt-1 w-full rounded border p-2 text-sm"
                type="date"
                value={date}
                min={yyyyMmDd(new Date())}
                onChange={(e) => setDate(e.target.value)}
              />
              <span className="mt-0.5 block text-xs text-gray-500">Tasks can only be created for today or future dates.</span>
            </label>
            <label className="text-sm"><span className="block font-medium">Level</span>
              <select className="mt-1 w-full rounded border p-2 text-sm" value={level} onChange={(e) => setLevel(e.target.value as "all" | LiteracyLevel)}>
                <option value="all">All levels</option>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <div className="text-sm">
              <span className="block font-medium">Skills</span>
              <div className="mt-2 flex flex-wrap gap-3">
                {SKILLS.map((s) => (
                  <label key={s} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedSkills.includes(s)} onChange={() => toggleSkill(s)} />
                    <span className="capitalize">{s}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* RP slider */}
            <div className="text-sm">
              <span className="block font-medium">Reading Points per task — <span className="font-bold text-black">{rpValue} RP</span></span>
              <input type="range" min={5} max={20} step={1} value={rpValue} onChange={(e) => setRpValue(Number(e.target.value))} className="mt-2 w-full" />
              <div className="flex justify-between text-xs text-gray-500"><span>5 RP</span><span>20 RP</span></div>
            </div>

            {/* Listening format — only shown when listening is selected */}
            {selectedSkills.includes("listening") && (
              <div className="text-sm rounded border p-3 bg-gray-50">
                <span className="block font-medium mb-2">Listening format</span>
                {(Object.entries(FORMAT_LABELS) as [TaskFormat, string][]).filter(([fmt]) => fmt !== "free_response").map(([fmt, label]) => (
                  <label key={fmt} className="flex items-center gap-2 mb-1 cursor-pointer">
                    <input type="radio" name="taskFormat" value={fmt} checked={taskFormat === fmt}
                      onChange={() => {
                        setTaskFormat(fmt);
                        setQbMsg(null);
                        // Switching to free_response clears the question builder —
                        // free response has no questions.
                        // Switching between structured formats (mcq ↔ msaq ↔ fill_blank)
                        // does NOT reset questions — the admin may be mixing question types
                        // in the same bank and needs to keep their unsaved work.
                        if (fmt === "free_response") {
                          setQuestions([]);
                          setLoadedQuestions([]);
                        }
                        // No DB fetch on format change — onAudioSelected handles that
                        // and is only triggered when the audio content item changes.
                      }} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Writing constraints — only shown when writing is selected */}
            {selectedSkills.includes("writing") && (
              <div className="text-sm rounded border p-3 bg-gray-50">
                <span className="block font-medium mb-2">Writing word count limits (optional)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Min words</label>
                    <input className="mt-1 w-full rounded border px-2 py-1 text-sm" type="number" min={1} max={2000} placeholder="e.g. 50" value={writingMinWords} onChange={(e) => setWritingMinWords(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Max words</label>
                    <input className="mt-1 w-full rounded border px-2 py-1 text-sm" type="number" min={1} max={5000} placeholder="e.g. 300" value={writingMaxWords} onChange={(e) => setWritingMaxWords(e.target.value)} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-400">Leave blank for no constraint.</p>
              </div>
            )}

            <button onClick={save} disabled={loading} className="mt-2 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60">
              {loading ? "Saving..." : "Save daily tasks"}
            </button>
          </div>
        </section>

        {/* Existing tasks panel */}
        <section className="rounded border p-4">
          <h2 className="text-lg font-semibold">Existing tasks for this date</h2>
          {loading && <p className="mt-2 text-sm text-gray-600">Loading...</p>}
          {tasks.length === 0
            ? <p className="mt-2 text-sm text-gray-600">No tasks created yet.</p>
            : <div className="mt-3 space-y-3">
                {tasks.map((t) => (
                  <div key={t.id} className="rounded border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize">{t.skill}</span>
                      <div className="flex items-center gap-3 text-gray-600 text-xs">
                        <span className="font-medium text-indigo-600">{t.rpValue} RP</span>
                        {t.skill === "listening" && t.taskFormat !== "free_response" && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">{t.taskFormat.replace("_", " ")}</span>
                        )}
                        {t.skill === "writing" && (t.writingMinWords || t.writingMaxWords) && (
                          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">
                            {t.writingMinWords && t.writingMaxWords ? `${t.writingMinWords}–${t.writingMaxWords}w` : t.writingMinWords ? `min ${t.writingMinWords}w` : `max ${t.writingMaxWords}w`}
                          </span>
                        )}
                        <span>{t.level ?? "all levels"}</span>
                      </div>
                    </div>
                    <ul className="mt-2 list-disc pl-5 text-gray-700">
                      {t.contentLinks.map((cl) => <li key={cl.contentItemId}>{cl.contentItem.title}</li>)}
                      {t.contentLinks.length === 0 && <li>No content attached</li>}
                    </ul>
                    {/* Delete — two-step confirmation */}
                    {deleteConfirmId === t.id ? (
                      <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                        <p className="font-semibold">Delete this task?</p>
                        <p className="mt-0.5">This will permanently remove the task and any pending submissions. Students who have already completed it will keep their RP.</p>
                        <p className="mt-0.5 font-medium">This cannot be undone.</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => void deleteTask(t.id)}
                            disabled={deletingTaskId === t.id}
                            className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-60"
                          >
                            {deletingTaskId === t.id ? "Deleting..." : "Yes, delete"}
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="rounded border px-3 py-1 text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirmId(t.id)}
                        className="mt-2 text-xs text-red-500 hover:text-red-700"
                      >
                        Delete task
                      </button>
                    )}
                  </div>
                ))}
              </div>
          }
        </section>
      </div>

      {/* Content attachment */}
<section className="mt-6 rounded border p-4">
  <h2 className="text-lg font-semibold">Attach content (per skill)</h2>
  <p className="mt-1 text-sm text-gray-600">Only affects skills you checked above.</p>

  <div className="mt-4 grid gap-4 md:grid-cols-2">
    {SKILLS.map((s) => {
      const enabled = selectedSkills.includes(s);
      const list = contentBySkillView[s];

      return (
        <div
          key={s}
          className={`rounded border p-3 ${!enabled ? "opacity-50" : ""}`}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-medium capitalize">{s}</h3>
            {!enabled && (
              <span className="text-xs text-gray-600">not selected</span>
            )}
          </div>

          {list.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">
              No content items for this skill.
            </p>
          ) : (
            <div className="mt-2 max-h-56 space-y-2 overflow-auto text-sm">
              {list.map((c) => (
                <label key={c.id} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`content-${s}`}
                    disabled={!enabled}
                    checked={contentBySkill[s]?.[0] === c.id}
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

      {/* Question builder — only shown when listening + structured format selected */}
      {selectedSkills.includes("listening") && taskFormat !== "free_response" && (
        <section className="mt-6 rounded border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Question Bank</h2>
              <p className="mt-1 text-sm text-gray-600">
                Build questions for this listening task. Correct answers are never shown to students before they submit.
              </p>
            </div>
            {/* Save question bank button — only shown when an audio is selected */}
            {selectedAudioId && (
              <div className="flex items-center gap-2 shrink-0">
                {qbIsDirty && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                    Unsaved changes
                  </span>
                )}
                <button
                  onClick={saveQuestionBank}
                  disabled={qbSaving || questions.length === 0}
                  className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                >
                  {qbSaving ? "Saving bank..." : "Save question bank"}
                </button>
              </div>
            )}
          </div>

          {qbMsg && (
            <p className={`mt-2 text-sm ${qbMsg.includes("⚠") ? "text-orange-600" : "text-green-700"}`}>
              {qbMsg}
            </p>
          )}

          {qbLoading && (
            <p className="mt-3 text-sm text-gray-500">Loading existing question bank...</p>
          )}

          {!qbLoading && !selectedAudioId && (
            <p className="mt-3 text-sm text-gray-500">
              Select a listening audio above to load or create its question bank.
            </p>
          )}

          {!qbLoading && selectedAudioId && (
            <div className="mt-4 space-y-4">
              {questions.map((q, i) => (
                <div key={q.id} className="rounded border p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Question {i + 1} — {q.type.replace("_", " ").toUpperCase()}</span>
                    <button onClick={() => removeQuestion(q.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                  </div>

                  {/* Prompt */}
                  <div>
                    <label className="text-xs font-medium text-gray-500">Prompt</label>
                    <input className="mt-1 w-full rounded border px-2 py-1 text-sm" value={q.prompt}
                      onChange={(e) => updateQuestion(q.id, { prompt: e.target.value })} placeholder="e.g. What was the dog's name?" />
                  </div>

                  {/* MCQ */}
                  {q.type === "mcq" && (
                    <div className="mt-3">
                      <label className="text-xs font-medium text-gray-500">Options (select one as correct)</label>
                      <div className="mt-1 space-y-1">
                        {(q as McqQ).options.map((opt, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <input type="radio" name={`correct_${q.id}`} checked={(q as McqQ).correctAnswer === opt && opt.trim() !== ""}
                              onChange={() => updateQuestion(q.id, { correctAnswer: opt } as Partial<McqQ>)} disabled={!opt.trim()} />
                            <input className="flex-1 rounded border px-2 py-1 text-sm" value={opt} placeholder={`Option ${oi + 1}`}
                              onChange={(e) => {
                                const opts = [...(q as McqQ).options]; opts[oi] = e.target.value;
                                updateQuestion(q.id, { options: opts } as Partial<McqQ>);
                              }} />
                          </div>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-gray-400">Click the radio button next to the correct option.</p>
                    </div>
                  )}

                  {/* MSAQ */}
                  {q.type === "msaq" && (
                    <div className="mt-3">
                      <div className="flex items-center gap-3 mb-2">
                        <label className="text-xs font-medium text-gray-500">Number of answers expected</label>
                        <input type="number" min={1} max={6} className="w-16 rounded border px-2 py-1 text-sm"
                          value={(q as MsaqQ).answerCount}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(6, parseInt(e.target.value) || 1));
                            const answers = [...(q as MsaqQ).correctAnswers];
                            while (answers.length < n) answers.push("");
                            updateQuestion(q.id, { answerCount: n, correctAnswers: answers.slice(0, n) } as Partial<MsaqQ>);
                          }} />
                      </div>
                      <label className="text-xs font-medium text-gray-500">Correct answers</label>
                      <div className="mt-1 space-y-1">
                        {(q as MsaqQ).correctAnswers.map((ans, ai) => (
                          <input key={ai} className="w-full rounded border px-2 py-1 text-sm" value={ans} placeholder={`Correct answer ${ai + 1}`}
                            onChange={(e) => {
                              const arr = [...(q as MsaqQ).correctAnswers]; arr[ai] = e.target.value;
                              updateQuestion(q.id, { correctAnswers: arr } as Partial<MsaqQ>);
                            }} />
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-gray-400">Any answer matching any of these (case-insensitive) counts as correct.</p>
                    </div>
                  )}

                  {/* Fill blank */}
                  {q.type === "fill_blank" && (
                    <div className="mt-3">
                      <label className="text-xs font-medium text-gray-500">Correct answer</label>
                      <input className="mt-1 w-full rounded border px-2 py-1 text-sm" value={(q as FillQ).correctAnswer} placeholder="e.g. park"
                        onChange={(e) => updateQuestion(q.id, { correctAnswer: e.target.value } as Partial<FillQ>)} />
                      <p className="mt-1 text-xs text-gray-400">Matching is case-insensitive and ignores leading/trailing spaces.</p>
                    </div>
                  )}
                </div>
              ))}

              {/* Add question buttons */}
              <div className="flex flex-wrap gap-2">
                {taskFormat === "mcq"        && <button onClick={() => addQuestion("mcq")}        className="rounded border px-3 py-1 text-sm">+ Add MCQ question</button>}
                {taskFormat === "msaq"       && <button onClick={() => addQuestion("msaq")}       className="rounded border px-3 py-1 text-sm">+ Add MSAQ question</button>}
                {taskFormat === "fill_blank" && <button onClick={() => addQuestion("fill_blank")} className="rounded border px-3 py-1 text-sm">+ Add fill-in-the-blank question</button>}
              </div>

              {questions.length === 0 && (
                <p className="text-sm text-gray-500">No questions yet. Use the button above to add your first question.</p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}