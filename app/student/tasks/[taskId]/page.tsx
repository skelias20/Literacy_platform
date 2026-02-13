// app/student/tasks/[taskId]/page.tsx
// c
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

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
  task: {
    id: string;
    skill: SkillType;
    level: string | null;
    taskDate: string;
  };
  content: ContentItem[];
  existingSubmission: {
    isCompleted: boolean;
    submittedAt: string | null;
    artifacts: Array<{
      id: string;
      skill: SkillType;
      textBody: string | null;
      fileId: string | null;
    }>;
  } | null;
};

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

  // text inputs (listening/writing)
  const [textResponse, setTextResponse] = useState("");

  // audio (reading/speaking)
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioUploadedFileId, setAudioUploadedFileId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // lock UI instantly on submit
  const [submitting, setSubmitting] = useState(false);

  async function load(currentTaskId: string) {
    setLoading(true);
    setErr(null);
    setMsg(null);

    const res = await fetch(`/api/student/daily-tasks/${currentTaskId}`);
    const data = (await res.json().catch(() => ({}))) as TaskDetail & { error?: string };

    if (!res.ok) {
      setErr(data.error ?? "Failed to load task.");
      setLoading(false);
      return;
    }

    setDetail(data);

    // preload existing state (if draft exists)
    const skill = data.task.skill;
    const existing = data.existingSubmission;

    if (existing) {
      const art = existing.artifacts.find((a) => a.skill === skill);

      if (skill === "listening" || skill === "writing") {
        setTextResponse(art?.textBody ?? "");
      }

      if (skill === "reading" || skill === "speaking") {
        if (art?.fileId) setAudioUploadedFileId(art.fileId);
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!taskId) return;
    void load(taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const isLocked = useMemo(() => {
    if (!detail?.existingSubmission) return false;
    return detail.existingSubmission.isCompleted;
  }, [detail]);

  // "done" rules (your definition)
  const canSubmit = useMemo(() => {
    if (!detail) return false;
    if (isLocked) return false;
    if (submitting) return false;

    const s = detail.task.skill;
    if (s === "reading" || s === "speaking") {
      return Boolean(audioUploadedFileId || audioBlob);
    }
    return textResponse.trim().length > 0;
  }, [detail, isLocked, submitting, audioUploadedFileId, audioBlob, textResponse]);

  async function startRecording() {
    setErr(null);
    setMsg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);

        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
      };

      recorder.start();
      setRecording(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? `${e.name} — ${e.message}` : "Mic error";
      setErr(`Mic error: ${msg}`);
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.stop();
    setRecording(false);
  }

  async function deleteRecording() {
    setErr(null);
    setMsg(null);

    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    if (audioUploadedFileId && detail) {
      const res = await fetch(
        `/api/student/daily-tasks/${detail.task.id}/artifact?skill=${detail.task.skill}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "Failed to delete uploaded audio.");
        return;
      }
      setAudioUploadedFileId(null);
      setMsg("Recording deleted. You can re-record.");
    }
  }

  async function uploadAudio(): Promise<boolean> {

    if (!audioBlob || !detail) return false;

    setErr(null);
    setMsg(null);

    const fd = new FormData();
    fd.append("file", audioBlob, `${detail.task.skill}.webm`);

    const res = await fetch(`/api/student/daily-tasks/${detail.task.id}/upload-audio`, {
      method: "POST",
      body: fd,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Upload failed.");
      return false;
    }

    setAudioUploadedFileId(data.fileId);

return true;


  }

  async function submit() {
    if (!detail) return;

    // lock UI instantly
    setSubmitting(true);
    setErr(null);
    setMsg(null);

    // If audio is required and not uploaded yet, force upload first
    if ((detail.task.skill === "reading" || detail.task.skill === "speaking") && !audioUploadedFileId) {
      if (!audioBlob) {
        setErr("Record audio first.");
        setSubmitting(false);
        return;
      }
      if(!audioUploadedFileId && audioBlob){
        const ok = await uploadAudio();
        if(!ok){
          setSubmitting(false);
          return;
        }
      }
      await uploadAudio();
      await load(detail.task.id);
    }

    const res = await fetch(`/api/student/daily-tasks/${detail.task.id}/submit`, {
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

    const ok = await uploadAudio();
if (!ok) {
  setSubmitting(false);
  return;
} 
await load(detail.task.id);


    window.location.href = "/student";
  }

  if (!taskId) {
    return (
      <main className="p-10">
        <p className="text-sm text-red-600">Missing taskId in URL.</p>
        <Link className="underline" href="/student">Back to dashboard</Link>
      </main>
    );
  }

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
        </div>
        <Link className="underline" href="/student">Back to dashboard</Link>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {msg && <p className="mt-3 text-sm text-green-700">{msg}</p>}

      <section className="mt-6 rounded border p-4">
        <h2 className="text-lg font-semibold">Task Content</h2>

        {detail.content.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No content attached by admin.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {detail.content.map((c) => (
              <div key={c.id} className="rounded border p-3">
                <p className="font-medium">{c.title}</p>
                {c.description && <p className="mt-1 text-sm text-gray-700">{c.description}</p>}

                {c.textBody && (
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">
                    {c.textBody}
                  </pre>
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
              <div className="flex flex-wrap gap-2">
                {!recording ? (
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    onClick={startRecording}
                    disabled={isLocked || submitting}
                  >
                    Start recording
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

                <button
                  className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-60"
                  disabled={!audioBlob || isLocked || submitting}
                  onClick={uploadAudio}
                >
                  Upload audio
                </button>

                <button
                  className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                  disabled={(!audioBlob && !audioUploadedFileId) || isLocked || submitting}
                  onClick={deleteRecording}
                >
                  Delete recording
                </button>
              </div>

              {audioUrl && <audio controls src={audioUrl} />}

              {audioUploadedFileId && (
                <p className="text-xs text-gray-600">Uploaded ✅ (ready to submit)</p>
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
      <button disabled={!canSubmit}>{submitting?"Submitting...":"Submit Task"} </button>
    </main>
  );
}
