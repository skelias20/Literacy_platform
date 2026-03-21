// app/student/tasks/[taskId]/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { studentFetch } from "@/lib/fetchWithAuth";

type SkillType = "reading" | "listening" | "writing" | "speaking";

type ContentItem = {
  id: string;
  title: string;
  description: string | null;
  skill: SkillType;
  type: string;
  textBody: string | null;
  assetUrl: string | null;
  mimeType: string | null;
};

type TaskDetail = {
  task: { id: string; skill: SkillType; level: string | null; taskDate: string };
  content: ContentItem[];
  existingSubmission: {
    isCompleted: boolean;
    submittedAt: string | null;
    rpEarned: number;
    artifacts: Array<{
      id: string;
      skill: SkillType;
      textBody: string | null;
      fileId: string | null;
    }>;
  } | null;
};

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB

function skillTitle(s: SkillType) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function StudentDailyTaskPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params?.taskId;

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [textResponse, setTextResponse] = useState("");

  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Tracks confirmed upload — once set, this fileId is in R2 + DB
  const [audioFileId, setAudioFileId] = useState<string | null>(null);
  const [audioUploading, setAudioUploading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const MAX_RECORDING_SECONDS = 600; // 10 minutes

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function clearRecordingTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsed(0);
  }

  // Separated load function so it can also be called after submit
  async function load(id: string) {
    setLoading(true);
    setErr(null);
    setMsg(null);
    const res = await studentFetch(`/api/student/daily-tasks/${id}`);
    const data = (await res.json().catch(() => ({}))) as TaskDetail & { error?: string };
    if (!res.ok) { setErr(data.error ?? "Failed to load task."); setLoading(false); return; }
    setDetail(data);

    const skill = data.task.skill;
    const existing = data.existingSubmission;
    if (existing) {
      const art = existing.artifacts.find((a) => a.skill === skill);
      if ((skill === "listening" || skill === "writing") && art?.textBody) {
        setTextResponse(art.textBody);
      }
      if ((skill === "reading" || skill === "speaking") && art?.fileId) {
        setAudioFileId(art.fileId);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setErr(null);
      setMsg(null);
      const res = await studentFetch(`/api/student/daily-tasks/${taskId}`);
      const data = (await res.json().catch(() => ({}))) as TaskDetail & { error?: string };
      if (cancelled) return;
      if (!res.ok) { setErr(data.error ?? "Failed to load task."); setLoading(false); return; }
      setDetail(data);

      const skill = data.task.skill;
      const existing = data.existingSubmission;
      if (existing) {
        const art = existing.artifacts.find((a) => a.skill === skill);
        if ((skill === "listening" || skill === "writing") && art?.textBody) {
          setTextResponse(art.textBody);
        }
        if ((skill === "reading" || skill === "speaking") && art?.fileId) {
          setAudioFileId(art.fileId);
        }
      }
      setLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, [taskId]);

  const isLocked = useMemo(
    () => detail?.existingSubmission?.isCompleted ?? false,
    [detail]
  );

  const canSubmit = useMemo(() => {
    if (!detail || isLocked || submitting || audioUploading) return false;
    const s = detail.task.skill;
    if (s === "reading" || s === "speaking") return !!(audioFileId || audioBlob);
    return textResponse.trim().length > 0;
  }, [detail, isLocked, submitting, audioUploading, audioFileId, audioBlob, textResponse]);

  // ── Presign → R2 PUT → Confirm ───────────────────────────────────────────
  async function uploadAudio(): Promise<string | null> {
    if (!audioBlob || !detail) return null;
    setAudioUploading(true);
    setErr(null);

    const mimeType = audioBlob.type || "audio/webm";

    if (audioBlob.size > MAX_AUDIO_BYTES) {
      setErr("Recording too large (max 10MB). Please re-record.");
      setAudioUploading(false);
      return null;
    }

    try {
      // Step 1: Presign — studentFetch handles 401 → redirect
      const presignRes = await studentFetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "daily_audio",
          mimeType,
          byteSize: audioBlob.size,
          originalName: `${detail.task.skill}.webm`,
          taskId: detail.task.id,
          skill: detail.task.skill,
        }),
      });
      const presignData = await presignRes.json().catch(() => ({}));
      if (!presignRes.ok) {
        setErr(presignData.error ?? "Failed to prepare upload.");
        setAudioUploading(false);
        return null;
      }
      const { presignedUrl, fileId } = presignData as { presignedUrl: string; fileId: string };

      // Step 2: PUT directly to R2 — raw fetch intentional, this is a Cloudflare URL
      const r2Res = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: audioBlob,
      });
      if (!r2Res.ok) {
        setErr("Upload to storage failed. Please try again.");
        setAudioUploading(false);
        return null;
      }

      // Step 3: Confirm — studentFetch handles 401 → redirect
      const confirmRes = await studentFetch("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          context: "daily_audio",
          taskId: detail.task.id,
          skill: detail.task.skill,
        }),
      });
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) {
        setErr(confirmData.error ?? "Upload confirmation failed.");
        setAudioUploading(false);
        return null;
      }

      setAudioFileId(fileId);
      setAudioUploading(false);
      return fileId;
    } catch {
      setErr("Upload failed. Check your connection and try again.");
      setAudioUploading(false);
      return null;
    }
  }

  async function submit() {
    if (!detail) return;
    setSubmitting(true);
    setErr(null);
    setMsg(null);

    // Upload audio if recorded but not yet uploaded
    if (
      (detail.task.skill === "reading" || detail.task.skill === "speaking") &&
      !audioFileId
    ) {
      if (!audioBlob) { setErr("Record audio first."); setSubmitting(false); return; }
      const fid = await uploadAudio();
      if (!fid) { setSubmitting(false); return; }
    }

    const res = await studentFetch(`/api/student/daily-tasks/${detail.task.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        textResponse:
          detail.task.skill === "listening" || detail.task.skill === "writing"
            ? textResponse
            : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Submit failed.");
      setSubmitting(false);
      return;
    }

    await load(detail.task.id);
    setSubmitting(false);
  }

  function startRecording() {
    setErr(null);
    clearRecordingTimer();
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data?.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          clearRecordingTimer();
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          setAudioBlob(blob);
          setAudioUrl(URL.createObjectURL(blob));
          setAudioFileId(null); // new recording invalidates previous upload
          setRecording(false);
        };
        recorder.start();
        setRecording(true);

        // Start elapsed timer — auto-stop at MAX_RECORDING_SECONDS
        let secs = 0;
        timerRef.current = setInterval(() => {
          secs += 1;
          setElapsed(secs);
          if (secs >= MAX_RECORDING_SECONDS) {
            if (recorder.state !== "inactive") recorder.stop();
          }
        }, 1000);
      })
      .catch((e: Error) => setErr(`Mic error: ${e.name} — ${e.message}`));
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    // Timer and recording state cleared inside onstop handler
  }

  function deleteRecording() {
    clearRecordingTimer();
    setRecording(false);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioFileId(null);
  }

  if (!taskId) return <main className="p-10"><p className="text-red-600">Missing taskId.</p></main>;
  if (loading) return <main className="p-10">Loading...</main>;
  if (!detail) return <main className="p-10">Not found.</main>;

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{skillTitle(detail.task.skill)} Task</h1>
          <p className="mt-1 text-sm text-gray-600">
            {isLocked ? "Completed ✅ (locked)" : "Complete and submit once."}
          </p>
          {isLocked && detail.existingSubmission && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-semibold text-indigo-700">
              🎉 You earned {detail.existingSubmission.rpEarned} RP for this task!
            </div>
          )}
        </div>
        <Link className="underline" href="/student">Back to dashboard</Link>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {msg && <p className="mt-3 text-sm text-green-700">{msg}</p>}

      <section className="mt-6 rounded border p-4">
        <h2 className="text-lg font-semibold">Task Content</h2>
        {detail.content.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No content attached.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {detail.content.map((c) => (
              <div key={c.id} className="rounded border p-3">
                <p className="font-medium">{c.title}</p>
                {c.description && <p className="mt-1 text-sm text-gray-700">{c.description}</p>}
                {c.textBody && (
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">{c.textBody}</pre>
                )}
                {c.assetUrl && c.mimeType?.startsWith("audio/") && (
                  <audio className="mt-2 w-full" controls src={c.assetUrl} />
                )}
                {c.assetUrl && !c.mimeType?.startsWith("audio/") && (
                  <a className="mt-2 inline-block underline" href={c.assetUrl} target="_blank" rel="noreferrer">
                    Open attached file
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded border p-4">
        <h2 className="text-lg font-semibold">Your Work</h2>

        {(detail.task.skill === "listening" || detail.task.skill === "writing") && (
          <div className="mt-3">
            <label className="text-sm font-medium">Your response</label>
            <textarea
              className="mt-1 w-full rounded border p-2 text-sm"
              rows={6}
              disabled={isLocked || submitting}
              value={textResponse}
              onChange={(e) => setTextResponse(e.target.value)}
              placeholder={detail.task.skill === "writing" ? "Write your answer..." : "Write what you heard..."}
            />
          </div>
        )}

        {(detail.task.skill === "reading" || detail.task.skill === "speaking") && (
          <div className="mt-3">
            <p className="text-sm text-gray-700">
              Record audio. You can delete and re-record until you submit.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {!recording ? (
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    onClick={startRecording}
                    disabled={isLocked || submitting || audioUploading}
                  >
                    {audioBlob ? "Re-record" : "Start recording"}
                  </button>
                ) : (
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    onClick={stopRecording}
                    disabled={isLocked || submitting}
                  >
                    Stop recording
                  </button>
                )}

                {audioBlob && !audioFileId && (
                  <button
                    className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-60"
                    disabled={!audioBlob || isLocked || submitting || audioUploading}
                    onClick={uploadAudio}
                  >
                    {audioUploading ? "Uploading..." : "Upload audio"}
                  </button>
                )}

                {(audioBlob || audioFileId) && (
                  <button
                    className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                    disabled={isLocked || submitting || audioUploading}
                    onClick={deleteRecording}
                  >
                    Delete recording
                  </button>
                )}

                {recording && (() => {
                  const remaining = MAX_RECORDING_SECONDS - elapsed;
                  const nearLimit = remaining <= 60;
                  return (
                    <span className={`text-sm font-mono ${nearLimit ? "text-red-600 font-bold" : "text-gray-600"}`}>
                      {nearLimit ? `⚠ ${formatDuration(remaining)} remaining` : `🔴 ${formatDuration(elapsed)}`}
                    </span>
                  );
                })()}
              </div>

              {recording && MAX_RECORDING_SECONDS - elapsed <= 60 && (
                <p className="text-xs text-red-600">Recording will stop automatically at 10 minutes.</p>
              )}

              {audioUrl && <audio controls src={audioUrl} />}
              {audioFileId && (
                <p className="text-xs text-green-700">✅ Uploaded to storage (ready to submit)</p>
              )}
              {audioUploading && (
                <p className="text-xs text-blue-600">Uploading to storage...</p>
              )}
            </div>
          </div>
        )}
      </section>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="mt-6 rounded bg-black px-4 py-2 text-white disabled:opacity-60"
      >
        {submitting ? "Submitting..." : isLocked ? "Already submitted" : "Submit task"}
      </button>
    </main>
  );
}