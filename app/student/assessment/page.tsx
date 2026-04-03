// app/student/assessment/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { studentFetch } from "@/lib/fetchWithAuth";
import { countWords } from "@/lib/wordCount";
import UnknownWordSaver from "@/components/UnknownWordSaver";
import GuidanceVideo from "@/components/GuidanceVideo";

type Skill      = "reading" | "listening" | "writing" | "speaking";
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
  skill: Skill; type: string; textBody: string | null;
  assetUrl: string | null; mimeType: string | null;
};

const MAX_AUDIO_BYTES        = 10 * 1024 * 1024;
const MAX_RECORDING_SECONDS  = 600;
const ASSESSMENT_WRITING_MIN = 3;
const ASSESSMENT_WRITING_MAX = 800;

function formatDuration(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

const SKILLS: Skill[] = ["reading", "listening", "writing", "speaking"];

export default function StudentAssessmentPage() {
  const router = useRouter();

  const [assessmentId, setAssessmentId]   = useState("");
  const [sessionNumber, setSessionNumber] = useState(1);
  const [totalSessions, setTotalSessions] = useState(1);
  const [taskFormat, setTaskFormat]       = useState<TaskFormat>("free_response");
  const [content, setContent]             = useState<ContentItem[]>([]);
  const [loading, setLoading]             = useState(true);
  const [err, setErr]                     = useState<string | null>(null);
  const [submitting, setSubmitting]       = useState(false);

  // Post-submit states
  const [submitted, setSubmitted]           = useState(false);
  const [isLastSession, setIsLastSession]   = useState(false);
  const [resultAnswers, setResultAnswers]   = useState<AnswerEntry[] | null>(null);

  // Audio state
  const [readingBlob,      setReadingBlob]      = useState<Blob | null>(null);
  const [readingUrl,       setReadingUrl]        = useState<string | null>(null);
  const [readingRecording, setReadingRecording]  = useState(false);
  const [readingFileId,    setReadingFileId]     = useState<string | null>(null);
  const [speakingBlob,     setSpeakingBlob]      = useState<Blob | null>(null);
  const [speakingUrl,      setSpeakingUrl]       = useState<string | null>(null);
  const [speakingRecording,setSpeakingRecording] = useState(false);
  const [speakingFileId,   setSpeakingFileId]    = useState<string | null>(null);

  const readingRecorderRef  = useRef<MediaRecorder | null>(null);
  const speakingRecorderRef = useRef<MediaRecorder | null>(null);
  const readingTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const [readingElapsed,  setReadingElapsed]  = useState(0);
  const [speakingElapsed, setSpeakingElapsed] = useState(0);

  const [listeningFree,      setListeningFree]      = useState("");
  const [writingText,        setWritingText]         = useState("");
  const [structuredAnswers,  setStructuredAnswers]   = useState<Record<string, string | string[]>>({});

  const [guidanceVideoUrl, setGuidanceVideoUrl] = useState<string | null>(null);

  // ── Fetch guidance video (no auth — public endpoint) ──────────────────
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await fetch("/api/page-videos/assessment");
      const data = await res.json().catch(() => ({})) as { videoUrl?: string | null };
      if (!cancelled) setGuidanceVideoUrl(data.videoUrl ?? null);
    };
    run().catch(() => { /* non-critical — video is optional */ });
    return () => { cancelled = true; };
  }, []);

  // ── Load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const res  = await studentFetch("/api/student/assessment");
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        if (data.blocked) {
          if (data.reason === "content_not_configured") {
            // Admin hasn't finished setting up assessment slots — show friendly message.
            setErr("Your assessment is being prepared. Please check back soon.");
            setLoading(false);
            return;
          }
          // For all other blocked states (wrong status, no pending assessment, etc.)
          // redirect back to dashboard since there's nothing actionable here.
          router.replace("/student");
          return;
        }
        setErr(data.error ?? "Failed to load assessment.");
        setLoading(false);
        return;
      }
      const aId = data.assessmentId ?? "";
      // Restore draft answers from localStorage before setting state
      const savedDraft = localStorage.getItem(`assessment_draft_${aId}`);
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft) as {
            listeningFree?: string;
            writingText?: string;
            structuredAnswers?: Record<string, string | string[]>;
          };
          if (draft.listeningFree)    setListeningFree(draft.listeningFree);
          if (draft.writingText)      setWritingText(draft.writingText);
          if (draft.structuredAnswers) setStructuredAnswers(draft.structuredAnswers);
        } catch { /* ignore corrupted draft */ }
      }
      setAssessmentId(aId);
      setSessionNumber(data.sessionNumber ?? 1);
      setTotalSessions(data.totalSessions ?? 1);
      setTaskFormat(data.taskFormat ?? "free_response");
      setContent(data.content ?? []);
      setLoading(false);
    };
    run().catch((e) => {
      if (!cancelled) {
        console.error("[assessment load]", e);
        setErr("Failed to load assessment.");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist draft answers to localStorage ────────────────────────────
  useEffect(() => {
    if (!assessmentId || loading || submitted) return;
    localStorage.setItem(`assessment_draft_${assessmentId}`, JSON.stringify({
      listeningFree, writingText, structuredAnswers,
    }));
  }, [assessmentId, loading, submitted, listeningFree, writingText, structuredAnswers]);

  // ── Warn on accidental navigation when progress exists ───────────────
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (submitted) return;
      const hasProgress =
        !!readingBlob || !!speakingBlob ||
        listeningFree.trim().length > 0 ||
        writingText.trim().length > 0 ||
        Object.keys(structuredAnswers).length > 0;
      if (!hasProgress) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [submitted, readingBlob, speakingBlob, listeningFree, writingText, structuredAnswers]);

  // ── Timer helpers ─────────────────────────────────────────────────────
  function clearTimer(skill: "reading" | "speaking") {
    const ref = skill === "reading" ? readingTimerRef : speakingTimerRef;
    if (ref.current) { clearInterval(ref.current); ref.current = null; }
    if (skill === "reading") setReadingElapsed(0); else setSpeakingElapsed(0);
  }

  function startTimer(skill: "reading" | "speaking", recorder: MediaRecorder) {
    clearTimer(skill);
    const setE = skill === "reading" ? setReadingElapsed : setSpeakingElapsed;
    const ref  = skill === "reading" ? readingTimerRef   : speakingTimerRef;
    let secs = 0;
    ref.current = setInterval(() => {
      secs += 1; setE(secs);
      if (secs >= MAX_RECORDING_SECONDS && recorder.state !== "inactive") recorder.stop();
    }, 1000);
  }

  // ── Listening helpers ─────────────────────────────────────────────────
  const listeningContent = content.find((c) => c.skill === "listening");
  const questions: Question[] = (() => {
    if (!listeningContent?.textBody) return [];
    try {
      const bank = JSON.parse(listeningContent.textBody) as { questions: Question[] };
      return bank.questions ?? [];
    } catch { return []; }
  })();
  const isStructured = taskFormat !== "free_response" && questions.length > 0;

  // ── Word count ────────────────────────────────────────────────────────
  const writingWordCount  = countWords(writingText);
  const writingBelowMin   = writingWordCount < ASSESSMENT_WRITING_MIN;
  const writingAboveMax   = writingWordCount > ASSESSMENT_WRITING_MAX;
  const writingCountColour = writingAboveMax
    ? "text-red-600 font-bold"
    : writingBelowMin ? "text-orange-500" : "text-green-700";

  // ── canSubmit ─────────────────────────────────────────────────────────
  const canSubmit = !submitting && !submitted && (() => {
    const hasReading  = !!(readingFileId  || readingBlob);
    const hasSpeaking = !!(speakingFileId || speakingBlob);
    const hasListening = isStructured
      ? questions.every((q) => {
          const a = structuredAnswers[q.id];
          if (q.type === "msaq") return Array.isArray(a) && (a as string[]).some((v) => v.trim());
          return typeof a === "string" && a.trim().length > 0;
        })
      : listeningFree.trim().length > 0;
    const hasWriting = writingText.trim().length > 0 && !writingBelowMin && !writingAboveMax;
    return hasReading && hasSpeaking && hasListening && hasWriting;
  })();

  // ── Upload audio ──────────────────────────────────────────────────────
  async function uploadAudio(skill: "reading" | "speaking", blob: Blob): Promise<string | null> {
    const mimeType = blob.type || "audio/webm";
    if (blob.size > MAX_AUDIO_BYTES) { setErr("Recording too large (max 10MB). Please re-record."); return null; }
    const presignRes = await studentFetch("/api/upload/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "assessment_audio", mimeType, byteSize: blob.size, originalName: `${skill}.webm`, assessmentId, skill }),
    });
    const presignData = await presignRes.json().catch(() => ({}));
    if (!presignRes.ok) { setErr(presignData.error ?? `Failed to prepare ${skill} upload.`); return null; }
    const { presignedUrl, fileId } = presignData as { presignedUrl: string; fileId: string };
    const r2Res = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: blob });
    if (!r2Res.ok) { setErr(`${skill} upload failed. Please try again.`); return null; }
    const confirmRes = await studentFetch("/api/upload/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, context: "assessment_audio", assessmentId, skill }),
    });
    const confirmData = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok) { setErr(confirmData.error ?? `${skill} confirmation failed.`); return null; }
    return fileId;
  }

  // ── Submit ────────────────────────────────────────────────────────────
  async function submit() {
    if (!canSubmit) { setErr("Please complete all parts before submitting."); return; }
    setSubmitting(true); setErr(null);

    // Upload any pending audio blobs
    let rFileId = readingFileId;
    let sFileId = speakingFileId;
    if (readingBlob && !readingFileId) {
      rFileId = await uploadAudio("reading", readingBlob);
      if (!rFileId) { setSubmitting(false); return; }
      setReadingFileId(rFileId);
    }
    if (speakingBlob && !speakingFileId) {
      sFileId = await uploadAudio("speaking", speakingBlob);
      if (!sFileId) { setSubmitting(false); return; }
      setSpeakingFileId(sFileId);
    }

    const body: Record<string, unknown> = { assessmentId };

    if (isStructured) {
      body.answers = structuredAnswers;
    }

    body.responses = {
      ...(isStructured ? {} : { listening: listeningFree || undefined }),
      writing: writingText || undefined,
    };

    const res  = await studentFetch("/api/student/assessment/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) { setErr((data as { error?: string }).error ?? "Submission failed. Please try again."); return; }

    setSubmitted(true);
    setIsLastSession(data.isLastSession ?? true);
    if (data.answersJson) setResultAnswers(data.answersJson as AnswerEntry[]);
    // Clear draft — submission is now on the server
    localStorage.removeItem(`assessment_draft_${assessmentId}`);
  }

  // ── Recording helpers ─────────────────────────────────────────────────
  function getRecordingState(s: Skill) {
    if (s === "reading")  return { blob: readingBlob,   url: readingUrl,   recording: readingRecording,   elapsed: readingElapsed,   fileId: readingFileId };
    return                       { blob: speakingBlob,  url: speakingUrl,  recording: speakingRecording,  elapsed: speakingElapsed,  fileId: speakingFileId };
  }

  async function startRecording(s: "reading" | "speaking") {
    const setBlob      = s === "reading" ? setReadingBlob      : setSpeakingBlob;
    const setUrl       = s === "reading" ? setReadingUrl        : setSpeakingUrl;
    const setRecording = s === "reading" ? setReadingRecording  : setSpeakingRecording;
    const recorderRef  = s === "reading" ? readingRecorderRef   : speakingRecorderRef;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (!stream) { setErr("Microphone access denied."); return; }
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      clearTimer(s);
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: "audio/webm" });
      setBlob(blob);
      setUrl(URL.createObjectURL(blob));
      setRecording(false);
      // Clear stored fileId — a re-recording invalidates the previous upload
      if (s === "reading")  setReadingFileId(null);
      if (s === "speaking") setSpeakingFileId(null);
    };
    recorder.start();
    setRecording(true);
    startTimer(s, recorder);
  }

  function stopRecording(s: "reading" | "speaking") {
    const recorderRef = s === "reading" ? readingRecorderRef : speakingRecorderRef;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
  }

  function deleteRecording(s: "reading" | "speaking") {
    if (s === "reading")  { setReadingBlob(null);  setReadingUrl(null);  setReadingFileId(null); }
    if (s === "speaking") { setSpeakingBlob(null); setSpeakingUrl(null); setSpeakingFileId(null); }
  }

  // ── Post-submit screen ────────────────────────────────────────────────
  if (submitted) {
    if (!isLastSession) {
      return (
        <main className="p-10 max-w-xl">
          <div className="rounded border border-amber-300 bg-amber-50 p-6">
            <h2 className="text-lg font-bold text-amber-900">
              Session {sessionNumber} of {totalSessions} Complete
            </h2>
            <p className="mt-2 text-sm text-amber-800">
              Well done! You have {totalSessions - sessionNumber} more session{totalSessions - sessionNumber !== 1 ? "s" : ""} remaining.
            </p>
            <p className="mt-3 text-sm text-amber-700 font-medium">
              📅 We recommend completing your next session tomorrow for your best results.
              A fresh start on a different day gives a more accurate picture of your abilities.
            </p>
            {resultAnswers && (
              <div className="mt-4">
                <p className="text-sm font-medium text-amber-900 mb-2">Listening results:</p>
                <AnswerReview entries={resultAnswers} />
              </div>
            )}
            <Link
              href="/student"
              className="mt-5 inline-block rounded bg-amber-600 px-4 py-2 text-sm text-white"
            >
              Return to dashboard
            </Link>
          </div>
        </main>
      );
    }

    return (
      <main className="p-10 max-w-xl">
        <div className="rounded border border-green-300 bg-green-50 p-6">
          <h2 className="text-lg font-bold text-green-900">Assessment Submitted</h2>
          <p className="mt-2 text-sm text-green-800">
            All {totalSessions} session{totalSessions !== 1 ? "s" : ""} complete.
            Your teacher will review your work and assign your level.
          </p>
          {resultAnswers && (
            <div className="mt-4">
              <p className="text-sm font-medium text-green-900 mb-2">Listening results:</p>
              <AnswerReview entries={resultAnswers} />
            </div>
          )}
          <Link href="/student" className="mt-5 inline-block rounded bg-green-700 px-4 py-2 text-sm text-white">
            Return to dashboard
          </Link>
        </div>
      </main>
    );
  }

  // ── Loading / error states ────────────────────────────────────────────
  if (loading) {
    return <main className="p-10"><p className="text-sm text-gray-500">Loading assessment...</p></main>;
  }

  if (err && content.length === 0) {
    return (
      <main className="p-10">
        <p className="text-sm text-red-600">{err}</p>
        <Link href="/student" className="mt-3 inline-block text-sm underline">Back to dashboard</Link>
      </main>
    );
  }

  // ── Main assessment form ──────────────────────────────────────────────
  return (
    <main className="p-10 max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Assessment</h1>
          {totalSessions > 1 && (
            <p className="mt-1 text-sm text-gray-600">
              Session {sessionNumber} of {totalSessions}
            </p>
          )}
        </div>
        <Link href="/student" className="text-sm underline text-gray-500">← Dashboard</Link>
      </div>

      <p className="mt-2 text-sm text-gray-600">
        Complete all four sections below. Your responses will be reviewed by your teacher.
      </p>

      {guidanceVideoUrl && <GuidanceVideo videoUrl={guidanceVideoUrl} />}

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-6 space-y-6">
        {SKILLS.map((s) => {
          const item = content.find((c) => c.skill === s);
          const { blob: audioBlob, url: audioUrl, recording, elapsed, fileId } = getRecordingState(s as "reading" | "speaking");
          const remaining  = MAX_RECORDING_SECONDS - elapsed;
          const nearLimit  = remaining <= 60;

          return (
            <section key={s} className="rounded border p-4">
              <h2 className="text-base font-semibold capitalize">{s}</h2>

              {/* Content item display */}
              {item && (
                <div className="mt-2">
                  {item.assetUrl && item.mimeType === "audio/mpeg" && (
                    <audio controls src={item.assetUrl} className="w-full" />
                  )}
                  {item.assetUrl && item.mimeType === "application/pdf" && (
                    <a href={item.assetUrl} target="_blank" rel="noreferrer"
                      className="inline-block rounded border px-3 py-1.5 text-sm underline">
                      Open reading passage (PDF)
                    </a>
                  )}
                  {item.textBody && s !== "listening" && (
                    <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{item.textBody}</p>
                  )}
                </div>
              )}

              {/* Reading / Speaking — audio recording */}
              {(s === "reading" || s === "speaking") && (() => (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {!recording
                      ? <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => startRecording(s as "reading" | "speaking")} disabled={submitting}>
                          {audioBlob ? "Re-record" : "Start recording"}
                        </button>
                      : <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => stopRecording(s as "reading" | "speaking")}>
                          Stop recording
                        </button>
                    }
                    {audioBlob && <button type="button" className="rounded border px-3 py-1 text-sm disabled:opacity-60" onClick={() => deleteRecording(s as "reading" | "speaking")} disabled={submitting}>Delete</button>}
                    {recording && (
                      <span className={`font-mono text-sm ${nearLimit ? "font-bold text-red-600" : "text-gray-600"}`}>
                        {nearLimit ? `⚠ ${formatDuration(remaining)} remaining` : `🔴 ${formatDuration(elapsed)}`}
                      </span>
                    )}
                  </div>
                  {recording && nearLimit && <p className="text-xs text-red-600">Recording will stop automatically at 10 minutes.</p>}
                  {audioUrl && <audio controls src={audioUrl} />}
                  {fileId && <p className="text-xs text-green-700">✅ Uploaded</p>}
                </div>
              ))()}

              {/* Listening — structured or free */}
              {s === "listening" && (
                isStructured
                  ? <QuestionBank questions={questions} answers={structuredAnswers} onChange={setStructuredAnswers} disabled={submitting} />
                  : <textarea
                      className="mt-2 w-full rounded border p-2 text-sm"
                      rows={4}
                      value={listeningFree}
                      onChange={(e) => setListeningFree(e.target.value)}
                      placeholder="Write what you understood from the audio..."
                      disabled={submitting}
                    />
              )}

              {/* Writing */}
              {s === "writing" && (
                <div className="mt-2">
                  <textarea
                    className="w-full rounded border p-2 text-sm"
                    rows={6}
                    value={writingText}
                    onChange={(e) => setWritingText(e.target.value)}
                    onPaste={(e) => e.preventDefault()}
                    onContextMenu={(e) => e.preventDefault()}
                    spellCheck={false}
                    placeholder="Write your answer here..."
                    disabled={submitting}
                  />
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className={writingCountColour}>
                      {writingWordCount} word{writingWordCount !== 1 ? "s" : ""}
                      {writingBelowMin && ` — minimum ${ASSESSMENT_WRITING_MIN}`}
                      {writingAboveMax && ` — maximum ${ASSESSMENT_WRITING_MAX}`}
                    </span>
                    <span className="text-gray-400">{ASSESSMENT_WRITING_MIN}–{ASSESSMENT_WRITING_MAX} words required</span>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="mt-6 rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit Assessment"}
      </button>

      <UnknownWordSaver source="assessment" />
    </main>
  );
}

// ── Question bank component ───────────────────────────────────────────────

type QuestionBankProps = {
  questions: Question[];
  answers: Record<string, string | string[]>;
  onChange: (a: Record<string, string | string[]>) => void;
  disabled: boolean;
};

function QuestionBank({ questions, answers, onChange, disabled }: QuestionBankProps) {
  function setAnswer(id: string, value: string | string[]) {
    onChange({ ...answers, [id]: value });
  }
  return (
    <div className="mt-3 space-y-4">
      {questions.map((q, i) => (
        <div key={q.id} className="rounded border p-3">
          <p className="text-sm font-medium">{i + 1}. {q.prompt}</p>
          {q.type === "mcq" && (
            <div className="mt-2 space-y-1">
              {(q as McqQuestion).options.map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name={q.id} value={opt} checked={answers[q.id] === opt}
                    onChange={() => setAnswer(q.id, opt)} disabled={disabled} />
                  {opt}
                </label>
              ))}
            </div>
          )}
          {q.type === "msaq" && (
            <div className="mt-2 space-y-1">
              {Array.from({ length: (q as MsaqQuestion).answerCount }).map((_, idx) => (
                <input key={idx} type="text" className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  placeholder={`Answer ${idx + 1}`}
                  value={(answers[q.id] as string[] | undefined)?.[idx] ?? ""}
                  onChange={(e) => {
                    const arr = [...((answers[q.id] as string[] | undefined) ?? Array((q as MsaqQuestion).answerCount).fill(""))];
                    arr[idx] = e.target.value;
                    setAnswer(q.id, arr);
                  }}
                  disabled={disabled} />
              ))}
            </div>
          )}
          {q.type === "fill_blank" && (
            <input type="text" className="mt-2 w-full rounded border px-2 py-1 text-sm"
              placeholder="Your answer..."
              value={(answers[q.id] as string) ?? ""}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              disabled={disabled} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Answer review (post-submit locked display) ────────────────────────────

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