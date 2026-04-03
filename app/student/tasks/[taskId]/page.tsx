// app/student/tasks/[taskId]/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { studentFetch } from "@/lib/fetchWithAuth";
import { countWords } from "@/lib/wordCount";
import UnknownWordSaver from "@/components/UnknownWordSaver";
import GuidanceVideo from "@/components/GuidanceVideo";

type SkillType  = "reading" | "listening" | "writing" | "speaking";
type TaskFormat = "free_response" | "mcq" | "msaq" | "fill_blank";

type McqQuestion  = { id: string; type: "mcq";        prompt: string; options: string[] };
type MsaqQuestion = { id: string; type: "msaq";       prompt: string; answerCount: number };
type FillQuestion = { id: string; type: "fill_blank"; prompt: string };
type Question = McqQuestion | MsaqQuestion | FillQuestion;

type AnswerEntry =
  | { questionId: string; studentAnswer: string;   isCorrect: boolean; correctAnswer: string }
  | { questionId: string; studentAnswers: string[]; correctAnswers: string[]; score: number; maxScore: number };

type ContentItem = {
  id: string; title: string; description: string | null;
  skill: SkillType; type: string; textBody: string | null;
  assetUrl: string | null; mimeType: string | null;
};
type TaskDetail = {
  task: {
    id: string; skill: SkillType; level: string | null; taskDate: string;
    taskFormat: TaskFormat; writingMinWords: number | null; writingMaxWords: number | null;
  };
  content: ContentItem[];
  existingSubmission: {
    isCompleted: boolean; submittedAt: string | null; rpEarned: number;
    artifacts: Array<{ id: string; skill: SkillType; textBody: string | null; fileId: string | null; answersJson: unknown }>;
  } | null;
};

const MAX_AUDIO_BYTES       = 10 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 600;

function fmt(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
function skillTitle(s: SkillType) { return s.charAt(0).toUpperCase() + s.slice(1); }

export default function StudentDailyTaskPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params?.taskId;

  const [detail, setDetail]           = useState<TaskDetail | null>(null);
  const [loading, setLoading]         = useState(true);
  const [err, setErr]                 = useState<string | null>(null);
  const [submitting, setSubmitting]   = useState(false);

  // Text / structured answers
  const [textResponse, setTextResponse]           = useState("");
  const [structuredAnswers, setStructuredAnswers] = useState<Record<string, string | string[]>>({});
  // Attempt tracking (1–3 for listening structured; single for all others)
  const [attemptNumber, setAttemptNumber]         = useState(1);
  // Result of last structured submission — shown after Check, hidden on retry
  const [resultAnswers, setResultAnswers]         = useState<AnswerEntry[] | null>(null);
  const [showResult, setShowResult]               = useState(false);

  // Audio
  const [audioBlob, setAudioBlob]         = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl]           = useState<string | null>(null);
  const [audioFileId, setAudioFileId]     = useState<string | null>(null);
  const [audioUploading, setAudioUploading] = useState(false);
  const [recording, setRecording]         = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<BlobPart[]>([]);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed]             = useState(0);

  const [guidanceVideoUrl, setGuidanceVideoUrl] = useState<string | null>(null);

  // ── Fetch guidance video (no auth — public endpoint) ──────────────────
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await fetch("/api/page-videos/task");
      const data = await res.json().catch(() => ({})) as { videoUrl?: string | null };
      if (!cancelled) setGuidanceVideoUrl(data.videoUrl ?? null);
    };
    run().catch(() => { /* non-critical — video is optional */ });
    return () => { cancelled = true; };
  }, []);

  // ── Load ─────────────────────────────────────────────────────────────
  async function load(id: string) {
    setLoading(true); setErr(null);
    const res  = await studentFetch(`/api/student/daily-tasks/${id}`);
    const data = (await res.json().catch(() => ({}))) as TaskDetail & { error?: string };
    if (!res.ok) { setErr(data.error ?? "Failed to load task."); setLoading(false); return; }
    setDetail(data);
    // Restore saved state if submission exists
    const skill    = data.task.skill;
    const existing = data.existingSubmission;
    if (existing) {
      const art = existing.artifacts.find((a) => a.skill === skill);
      if ((skill === "listening" || skill === "writing") && art?.textBody) setTextResponse(art.textBody);
      if ((skill === "reading" || skill === "speaking") && art?.fileId)    setAudioFileId(art.fileId);
      if (skill === "listening" && art?.answersJson) {
        setResultAnswers(art.answersJson as AnswerEntry[]);
        setShowResult(true);
      }
      // Rehydrate attempt number for structured listening mid-retry (attempt 1 done, not yet locked)
      if (skill === "listening" && !existing.isCompleted && existing.submittedAt) {
        const saved = localStorage.getItem(`task_attempt_${id}`);
        if (saved) {
          const n = parseInt(saved, 10);
          if (n >= 2 && n <= 3) setAttemptNumber(n);
        }
      }
      // Clear localStorage once the task is fully locked
      if (existing.isCompleted) {
        localStorage.removeItem(`task_attempt_${id}`);
        localStorage.removeItem(`task_draft_${id}`);
      }
    } else {
      // No server submission yet — restore draft answers from localStorage
      const savedDraft = localStorage.getItem(`task_draft_${id}`);
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft) as {
            textResponse?: string;
            structuredAnswers?: Record<string, string | string[]>;
            audioFileId?: string;
          };
          if (draft.textResponse)      setTextResponse(draft.textResponse);
          if (draft.structuredAnswers) setStructuredAnswers(draft.structuredAnswers);
          if (draft.audioFileId)       setAudioFileId(draft.audioFileId);
        } catch { /* ignore corrupted draft */ }
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    // Delegate to the standalone load() — same fetch + state-restore logic used after submit.
    // The cancelled flag guards the catch handler only; load() handles all normal error paths.
    load(taskId).catch((e) => {
      if (!cancelled) {
        console.error("[task load]", e);
        setErr("Failed to load task.");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [taskId]);

  const isLocked    = useMemo(() => detail?.existingSubmission?.isCompleted ?? false, [detail]);

  // ── Persist draft to localStorage after load completes ───────────────
  useEffect(() => {
    if (!taskId || loading || isLocked) return;
    localStorage.setItem(`task_draft_${taskId}`, JSON.stringify({
      textResponse, structuredAnswers, audioFileId,
    }));
  }, [taskId, loading, isLocked, textResponse, structuredAnswers, audioFileId]);

  // ── Warn on accidental navigation when progress exists ───────────────
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (isLocked) return;
      const hasProgress =
        !!audioBlob ||
        textResponse.trim().length > 0 ||
        Object.keys(structuredAnswers).length > 0;
      if (!hasProgress) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isLocked, audioBlob, textResponse, structuredAnswers]);
  const taskFormat  = detail?.task.taskFormat  ?? "free_response";
  const minWords    = detail?.task.writingMinWords  ?? null;
  const maxWords    = detail?.task.writingMaxWords  ?? null;
  const skill       = detail?.task.skill;
  const isStructured = skill === "listening" && taskFormat !== "free_response";

  // ── Question bank ─────────────────────────────────────────────────────
  const questions = useMemo<Question[]>(() => {
    if (!isStructured || !detail) return [];
    const listeningItem = detail.content.find((c) => c.skill === "listening" && c.textBody?.startsWith("{"));
    if (!listeningItem?.textBody) return [];
    try { return (JSON.parse(listeningItem.textBody) as { questions: Question[] }).questions ?? []; }
    catch { return []; }
  }, [isStructured, detail]);

  // ── Word count ────────────────────────────────────────────────────────
  const wordCount    = countWords(textResponse);
  const belowMin     = minWords !== null && wordCount < minWords;
  const aboveMax     = maxWords !== null && wordCount > maxWords;
  const wcColour     = aboveMax ? "text-red-600 font-bold" : belowMin ? "text-orange-500" : "text-green-700";

  // ── canSubmit ─────────────────────────────────────────────────────────
  const canSubmit = useMemo(() => {
    if (!detail || isLocked || submitting || audioUploading) return false;
    if (skill === "reading" || skill === "speaking") return !!(audioFileId || audioBlob);
    if (skill === "writing") return textResponse.trim().length > 0 && !belowMin && !aboveMax;
    if (skill === "listening") {
      if (!isStructured) return textResponse.trim().length > 0;
      // For structured: must answer all questions and not be showing results (waiting for retry or locked)
      if (showResult && !isLocked) return false; // waiting for "Try again" click
      return questions.every((q) => {
        const a = structuredAnswers[q.id];
        if (q.type === "msaq") return Array.isArray(a) && (a as string[]).some((v) => v.trim());
        return typeof a === "string" && a.trim().length > 0;
      });
    }
    return false;
  }, [detail, isLocked, submitting, audioUploading, skill, audioFileId, audioBlob, textResponse, belowMin, aboveMax, isStructured, showResult, questions, structuredAnswers]);

  // ── Audio upload ──────────────────────────────────────────────────────
  async function uploadAudio(): Promise<string | null> {
    if (!audioBlob || !detail) return null;
    setAudioUploading(true); setErr(null);
    const mimeType = audioBlob.type || "audio/webm";
    if (audioBlob.size > MAX_AUDIO_BYTES) { setErr("Recording too large (max 10MB)."); setAudioUploading(false); return null; }

    const presignRes = await studentFetch("/api/upload/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "daily_audio", mimeType, byteSize: audioBlob.size, originalName: `${detail.task.skill}.webm`, taskId: detail.task.id, skill: detail.task.skill }),
    });
    const pd = await presignRes.json().catch(() => ({}));
    if (!presignRes.ok) { setErr(pd.error ?? "Failed to prepare upload."); setAudioUploading(false); return null; }
    const { presignedUrl, fileId } = pd as { presignedUrl: string; fileId: string };

    const r2 = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: audioBlob });
    if (!r2.ok) { setErr("Upload failed. Please try again."); setAudioUploading(false); return null; }

    const confirmRes = await studentFetch("/api/upload/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, context: "daily_audio", taskId: detail.task.id, skill: detail.task.skill }),
    });
    const cd = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok) { setErr(cd.error ?? "Upload confirmation failed."); setAudioUploading(false); return null; }

    setAudioFileId(fileId); setAudioUploading(false); return fileId;
  }

  // ── Client-side scoring for structured listening retries ─────────────
  // After attempt 1, resultAnswers contains correct answers embedded in each entry.
  // Attempts 2 and 3 score locally against those — no server round-trip needed.
  function scoreLocally(
    currentAnswers: Record<string, string | string[]>,
    prevResults: AnswerEntry[]
  ): AnswerEntry[] {
    return prevResults.map((prev) => {
      if ("isCorrect" in prev) {
        const student = String(currentAnswers[prev.questionId] ?? "").trim().toLowerCase();
        const correct = prev.correctAnswer.trim().toLowerCase();
        return {
          questionId: prev.questionId,
          studentAnswer: String(currentAnswers[prev.questionId] ?? ""),
          isCorrect: student === correct,
          correctAnswer: prev.correctAnswer,
        };
      } else {
        const studentArr = Array.isArray(currentAnswers[prev.questionId])
          ? (currentAnswers[prev.questionId] as string[])
          : [String(currentAnswers[prev.questionId] ?? "")];
        const correctSet = prev.correctAnswers.map((a) => a.trim().toLowerCase());
        const score = studentArr.filter((a) => correctSet.includes(a.trim().toLowerCase())).length;
        return {
          questionId: prev.questionId,
          studentAnswers: studentArr,
          correctAnswers: prev.correctAnswers,
          score,
          maxScore: prev.maxScore,
        };
      }
    });
  }

  // ── Submit ────────────────────────────────────────────────────────────
  async function submit() {
    if (!detail) return;
    setSubmitting(true); setErr(null); setShowResult(false);

    if ((skill === "reading" || skill === "speaking") && !audioFileId) {
      if (!audioBlob) { setErr("Record audio first."); setSubmitting(false); return; }
      const fid = await uploadAudio();
      if (!fid) { setSubmitting(false); return; }
    }

    if (isStructured) {
      if (attemptNumber === 1) {
        // Attempt 1: POST to server — scores, persists artifact, returns answersJson with correct answers
        const res = await studentFetch(`/api/student/daily-tasks/${detail.task.id}/submit`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptNumber: 1, answers: structuredAnswers }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(res.status === 404 ? "This task has been removed by your instructor. We appreciate your effort — a new task will be sent your way soon." : data.error ?? "Submit failed."); setSubmitting(false); return; }
        if (data.answersJson) {
          setResultAnswers(data.answersJson as AnswerEntry[]);
          setShowResult(true);
        }
        await load(detail.task.id);
      } else if (attemptNumber === 2) {
        // Attempt 2: score client-side — no server call
        if (resultAnswers) {
          setResultAnswers(scoreLocally(structuredAnswers, resultAnswers));
          setShowResult(true);
        }
      } else {
        // Attempt 3: score client-side, then POST to lock the submission (no answers needed)
        if (resultAnswers) {
          setResultAnswers(scoreLocally(structuredAnswers, resultAnswers));
          setShowResult(true);
        }
        const res = await studentFetch(`/api/student/daily-tasks/${detail.task.id}/submit`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptNumber: 3 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(res.status === 404 ? "This task has been removed by your instructor. We appreciate your effort — a new task will be sent your way soon." : data.error ?? "Submit failed."); setSubmitting(false); return; }
        await load(detail.task.id);
      }
      setSubmitting(false);
      return;
    }

    // Non-structured skills (reading, speaking, writing, listening free-response)
    const body: Record<string, unknown> = { attemptNumber };
    body.textResponse = (skill === "listening" || skill === "writing") ? textResponse : null;

    const res  = await studentFetch(`/api/student/daily-tasks/${detail.task.id}/submit`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(res.status === 404 ? "This task has been removed by your instructor. We appreciate your effort — a new task will be sent your way soon." : data.error ?? "Submit failed."); setSubmitting(false); return; }

    await load(detail.task.id);
    setSubmitting(false);
  }

  // Retry — hide results, reset answers, increment attempt, persist to localStorage
  function retry() {
    setShowResult(false);
    setStructuredAnswers({});
    setAttemptNumber((n) => {
      const next = Math.min(n + 1, 3);
      if (taskId) localStorage.setItem(`task_attempt_${taskId}`, String(next));
      return next;
    });
  }

  // ── Recording ─────────────────────────────────────────────────────────
  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setElapsed(0);
  }
  function startRecording() {
    setErr(null); clearTimer();
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        clearTimer(); stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob)); setAudioFileId(null); setRecording(false);
      };
      recorder.start(); setRecording(true);
      let secs = 0;
      timerRef.current = setInterval(() => {
        secs += 1; setElapsed(secs);
        if (secs >= MAX_RECORDING_SECONDS && recorder.state !== "inactive") recorder.stop();
      }, 1000);
    }).catch((e: Error) => setErr(`Mic error: ${e.name} — ${e.message}`));
  }
  function stopRecording() { mediaRecorderRef.current?.stop(); }
  function deleteRecording() {
    clearTimer(); setRecording(false); setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null); setAudioFileId(null);
  }

  if (!taskId) return <main className="p-10"><p className="text-red-600">Missing taskId.</p></main>;
  if (loading)  return <main className="p-10">Loading...</main>;
  if (!detail)  return <main className="p-10">Not found.</main>;

  const remaining = MAX_RECORDING_SECONDS - elapsed;
  const nearLimit = remaining <= 60;

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{skillTitle(detail.task.skill)} Task</h1>
          <p className="mt-1 text-sm text-gray-600">
            {isLocked
              ? "Completed ✅ (locked)"
              : detail.existingSubmission?.submittedAt
              ? "Submission saved — you can still retry the questions."
              : "Complete and submit once."}
          </p>
          {isLocked && detail.existingSubmission && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-semibold text-indigo-700">
              🎉 You earned {detail.existingSubmission.rpEarned} RP for this task!
            </div>
          )}
        </div>
        <Link className="underline" href="/student">Back to dashboard</Link>
      </div>

      {guidanceVideoUrl && <GuidanceVideo videoUrl={guidanceVideoUrl} />}

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      {/* Content */}
      <section className="mt-6 rounded border p-4">
        <h2 className="text-lg font-semibold">Task Content</h2>
        {detail.content.length === 0
          ? <p className="mt-2 text-sm text-gray-600">No content attached.</p>
          : <div className="mt-3 space-y-3">
              {detail.content.filter((c) => {
                // Hide raw JSON content blocks from display for structured listening
                if (isStructured && c.skill === "listening") return !c.textBody?.startsWith("{");
                return true;
              }).map((c) => (
                <div key={c.id} className="rounded border p-3">
                  <p className="font-medium">{c.title}</p>
                  {c.description && <p className="mt-1 text-sm text-gray-700">{c.description}</p>}
                  {c.textBody && !c.textBody.startsWith("{") && (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">{c.textBody}</pre>
                  )}
                  {c.assetUrl && c.mimeType?.startsWith("audio/") && <audio className="mt-2 w-full" controls src={c.assetUrl} />}
                  {c.assetUrl && !c.mimeType?.startsWith("audio/") && (
                    <a className="mt-2 inline-block underline" href={c.assetUrl} target="_blank" rel="noreferrer">Open attached file</a>
                  )}
                </div>
              ))}
            </div>
        }
      </section>

      {/* Response */}
      <section className="mt-6 rounded border p-4">
        <h2 className="text-lg font-semibold">Your Work</h2>

        {/* Audio skills */}
        {(skill === "reading" || skill === "speaking") && (
          <div className="mt-3">
            <p className="text-sm text-gray-700">Record audio. You can re-record until you submit.</p>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {!recording
                  ? <button className="rounded border px-3 py-1 text-sm" onClick={startRecording} disabled={isLocked || submitting || audioUploading}>{audioBlob ? "Re-record" : "Start recording"}</button>
                  : <button className="rounded border px-3 py-1 text-sm" onClick={stopRecording} disabled={isLocked || submitting}>Stop recording</button>
                }
                {audioBlob && !audioFileId && (
                  <button className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-60" disabled={!audioBlob || isLocked || submitting || audioUploading} onClick={uploadAudio}>
                    {audioUploading ? "Uploading..." : "Upload audio"}
                  </button>
                )}
                {(audioBlob || audioFileId) && <button className="rounded border px-3 py-1 text-sm disabled:opacity-60" disabled={isLocked || submitting || audioUploading} onClick={deleteRecording}>Delete recording</button>}
                {recording && (
                  <span className={`font-mono text-sm ${nearLimit ? "font-bold text-red-600" : "text-gray-600"}`}>
                    {nearLimit ? `⚠ ${fmt(remaining)} remaining` : `🔴 ${fmt(elapsed)}`}
                  </span>
                )}
              </div>
              {recording && nearLimit && <p className="text-xs text-red-600">Recording will stop automatically at 10 minutes.</p>}
              {audioUrl && <audio controls src={audioUrl} />}
              {audioFileId && <p className="text-xs text-green-700">✅ Uploaded to storage (ready to submit)</p>}
              {audioUploading && <p className="text-xs text-blue-600">Uploading to storage...</p>}
            </div>
          </div>
        )}

        {/* Writing */}
        {skill === "writing" && (
          <div className="mt-3">
            <label className="text-sm font-medium">Your response</label>
            <textarea
              className="mt-1 w-full rounded border p-2 text-sm"
              rows={6}
              disabled={isLocked || submitting}
              value={textResponse}
              onChange={(e) => setTextResponse(e.target.value)}
              onPaste={(e) => { if (!isLocked) e.preventDefault(); }}
              onContextMenu={(e) => { if (!isLocked) e.preventDefault(); }}
              spellCheck={false}
              placeholder="Write your answer..."
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className={isLocked ? "text-gray-500" : wcColour}>
                {wordCount} word{wordCount !== 1 ? "s" : ""}
                {!isLocked && belowMin && minWords && ` — minimum ${minWords}`}
                {!isLocked && aboveMax && maxWords && ` — maximum ${maxWords}`}
              </span>
              {(minWords || maxWords) && (
                <span className="text-gray-400">
                  {minWords && maxWords ? `${minWords}–${maxWords} words` : minWords ? `min ${minWords} words` : `max ${maxWords} words`}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Listening — free response */}
        {skill === "listening" && !isStructured && (
          <div className="mt-3">
            <label className="text-sm font-medium">Your response</label>
            <textarea
              className="mt-1 w-full rounded border p-2 text-sm"
              rows={6}
              disabled={isLocked || submitting}
              value={textResponse}
              onChange={(e) => setTextResponse(e.target.value)}
              placeholder="Write what you heard..."
            />
          </div>
        )}

        {/* Listening — structured questions */}
        {skill === "listening" && isStructured && (
          <div className="mt-3">
            {/* Show results after submission, hide during retry */}
            {showResult && resultAnswers && (
              <div className="mb-4 rounded border p-3">
                <p className="text-sm font-semibold mb-2">Results</p>
                <AnswerReview entries={resultAnswers} />
                {!isLocked && attemptNumber < 3 && (
                  <button
                    className="mt-3 rounded border px-3 py-1 text-sm"
                    onClick={retry}
                  >
                    Try again ({3 - attemptNumber} attempt{3 - attemptNumber !== 1 ? "s" : ""} remaining)
                  </button>
                )}
                {!isLocked && attemptNumber >= 3 && (
                  <p className="mt-2 text-xs text-gray-500">No more attempts remaining. Submit to lock.</p>
                )}
              </div>
            )}

            {/* Questions — hidden while showing results, shown during attempt */}
            {!showResult && !isLocked && (
              <QuestionBank
                questions={questions}
                answers={structuredAnswers}
                onChange={setStructuredAnswers}
                disabled={submitting}
              />
            )}

            {/* Locked state — show final results */}
            {isLocked && resultAnswers && (
              <div className="rounded border p-3">
                <p className="text-sm font-semibold mb-2">Final Results</p>
                <AnswerReview entries={resultAnswers} />
              </div>
            )}
          </div>
        )}
      </section>

      {!isLocked && (
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-6 rounded bg-black px-4 py-2 text-white disabled:opacity-60"
        >
          {submitting ? "Submitting..." : isStructured && !showResult ? "Check answers" : "Submit task"}
        </button>
      )}

      {isLocked && (
        <p className="mt-6 text-sm text-gray-500">This task has been submitted and locked.</p>
      )}

      <UnknownWordSaver source="daily_task" />
    </main>
  );
}

// ── Shared components ─────────────────────────────────────────────────────

type QuestionBankProps = {
  questions: Question[];
  answers: Record<string, string | string[]>;
  onChange: (a: Record<string, string | string[]>) => void;
  disabled: boolean;
};

function QuestionBank({ questions, answers, onChange, disabled }: QuestionBankProps) {
  function set(id: string, value: string | string[]) { onChange({ ...answers, [id]: value }); }
  return (
    <div className="space-y-4">
      {questions.map((q, i) => (
        <div key={q.id} className="rounded border p-3">
          <p className="text-sm font-medium">{i + 1}. {q.prompt}</p>
          {q.type === "mcq" && (
            <div className="mt-2 space-y-1">
              {(q as McqQuestion).options.map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name={q.id} value={opt} checked={answers[q.id] === opt} onChange={() => set(q.id, opt)} disabled={disabled} />
                  {opt}
                </label>
              ))}
            </div>
          )}
          {q.type === "msaq" && (
            <div className="mt-2 space-y-1">
              {Array.from({ length: (q as MsaqQuestion).answerCount }).map((_, idx) => (
                <input key={idx} type="text" className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder={`Answer ${idx + 1}`}
                  value={(answers[q.id] as string[] | undefined)?.[idx] ?? ""}
                  onChange={(e) => {
                    const arr = [...((answers[q.id] as string[] | undefined) ?? Array((q as MsaqQuestion).answerCount).fill(""))];
                    arr[idx] = e.target.value;
                    set(q.id, arr);
                  }}
                  disabled={disabled}
                />
              ))}
            </div>
          )}
          {q.type === "fill_blank" && (
            <input type="text" className="mt-2 w-full rounded border px-2 py-1 text-sm" placeholder="Your answer..."
              value={(answers[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} disabled={disabled} />
          )}
        </div>
      ))}
    </div>
  );
}

function AnswerReview({ entries }: { entries: AnswerEntry[] }) {
  return (
    <div className="space-y-2">
      {entries.map((e, i) => {
        if ("studentAnswers" in e) {
          return (
            <div key={i} className="rounded border p-2 text-sm">
              <p className="font-medium">Q{i + 1}: {e.score}/{e.maxScore} correct</p>
              <p className="text-xs text-gray-500">Your answers: {e.studentAnswers.join(", ")}</p>
              <p className="text-xs text-green-700">Correct: {e.correctAnswers.join(", ")}</p>
            </div>
          );
        }
        return (
          <div key={i} className={`rounded border p-2 text-sm ${e.isCorrect ? "border-green-300 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <p className="font-medium">Q{i + 1}: {e.isCorrect ? "✅ Correct" : "❌ Incorrect"}</p>
            <p className="text-xs text-gray-600">Your answer: {e.studentAnswer}</p>
            {!e.isCorrect && <p className="text-xs text-green-700">Correct: {e.correctAnswer}</p>}
          </div>
        );
      })}
    </div>
  );
}