"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Skill = "reading" | "listening" | "writing" | "speaking";

type ContentItem = {
  id: string;
  title: string;
  description: string | null;
  skill: Skill;
  type: string;
  textBody: string | null;
  assetUrl: string | null;
  mimeType: string | null;
};

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB

export default function StudentAssessmentPage() {
  const [assessmentId, setAssessmentId] = useState<string>("");
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [readingAudioBlob, setReadingAudioBlob] = useState<Blob | null>(null);
  const [readingAudioUrl, setReadingAudioUrl] = useState<string | null>(null);
  const [readingRecording, setReadingRecording] = useState(false);
  const [readingFileId, setReadingFileId] = useState<string | null>(null);

  const [speakingAudioBlob, setSpeakingAudioBlob] = useState<Blob | null>(null);
  const [speakingAudioUrl, setSpeakingAudioUrl] = useState<string | null>(null);
  const [speakingRecording, setSpeakingRecording] = useState(false);
  const [speakingFileId, setSpeakingFileId] = useState<string | null>(null);

  const readingRecorderRef = useRef<MediaRecorder | null>(null);
  const speakingRecorderRef = useRef<MediaRecorder | null>(null);
  const router = useRouter();

  const [responses, setResponses] = useState<Record<Skill, string>>({
    reading: "",
    listening: "",
    writing: "",
    speaking: "",
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const res = await fetch("/api/student/assessment");
      const data = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok && data.blocked) { router.replace("/student"); return; }
      setAssessmentId(data.assessmentId);
      setContent(data.content ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit =
    !submitting &&
    (!!readingFileId || !!readingAudioBlob) &&
    (!!speakingFileId || !!speakingAudioBlob) &&
    responses.listening.trim().length > 0 &&
    responses.writing.trim().length > 0;

  // ── Presign → R2 PUT → Confirm ───────────────────────────────────────────
  async function uploadAudio(
    skill: "reading" | "speaking",
    blob: Blob
  ): Promise<string | null> {
    const mimeType = blob.type || "audio/webm";

    if (blob.size > MAX_AUDIO_BYTES) {
      setErr("Recording is too large (max 10MB). Please re-record a shorter clip.");
      return null;
    }

    // Step 1: Presign
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: "assessment_audio",
        mimeType,
        byteSize: blob.size,
        originalName: `${skill}.webm`,
        assessmentId,
        skill,
      }),
    });
    const presignData = await presignRes.json().catch(() => ({}));
    if (!presignRes.ok) {
      setErr(presignData.error ?? `Failed to prepare ${skill} upload.`);
      return null;
    }
    const { presignedUrl, fileId } = presignData as {
      presignedUrl: string;
      fileId: string;
    };

    // Step 2: PUT directly to R2
    const r2Res = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType, "Content-Length": String(blob.size) },
      body: blob,
    });
    if (!r2Res.ok) {
      setErr(`${skill} upload to storage failed. Please try again.`);
      return null;
    }

    // Step 3: Confirm
    const confirmRes = await fetch("/api/upload/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId,
        context: "assessment_audio",
        assessmentId,
        skill,
      }),
    });
    const confirmData = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok) {
      setErr(confirmData.error ?? `${skill} upload confirmation failed.`);
      return null;
    }

    return fileId;
  }

  async function submit() {
    if (!canSubmit) {
      setErr("Please complete all parts of the assessment before submitting.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    setMsg(null);

    try {
      // Upload reading if not already uploaded
      let rFileId = readingFileId;
      if (!rFileId && readingAudioBlob) {
        rFileId = await uploadAudio("reading", readingAudioBlob);
        if (!rFileId) { setSubmitting(false); return; }
        setReadingFileId(rFileId);
      }

      // Upload speaking if not already uploaded
      let sFileId = speakingFileId;
      if (!sFileId && speakingAudioBlob) {
        sFileId = await uploadAudio("speaking", speakingAudioBlob);
        if (!sFileId) { setSubmitting(false); return; }
        setSpeakingFileId(sFileId);
      }

      // Submit text responses
      const res = await fetch("/api/student/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          responses: {
            listening: responses.listening,
            writing: responses.writing,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "Submit failed.");
        setSubmitting(false);
        return;
      }

      setMsg("Submitted. Your admin will review and assign your level.");
      router.push("/student");
    } catch {
      setErr("Submission failed. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  // ── Recording helpers ────────────────────────────────────────────────────
  async function startRecording(
    skill: "reading" | "speaking"
  ): Promise<void> {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        if (skill === "reading") {
          setReadingAudioBlob(blob);
          setReadingAudioUrl(url);
          setReadingRecording(false);
          setReadingFileId(null); // new recording invalidates previous upload
        } else {
          setSpeakingAudioBlob(blob);
          setSpeakingAudioUrl(url);
          setSpeakingRecording(false);
          setSpeakingFileId(null);
        }
      };
      if (skill === "reading") {
        readingRecorderRef.current = recorder;
        setReadingRecording(true);
      } else {
        speakingRecorderRef.current = recorder;
        setSpeakingRecording(true);
      }
      recorder.start();
    } catch (e: unknown) {
      const domErr = e as DOMException;
      setErr(`Mic error: ${domErr.name} — ${domErr.message}`);
    }
  }

  function stopRecording(skill: "reading" | "speaking") {
    const rec = skill === "reading"
      ? readingRecorderRef.current
      : speakingRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function deleteRecording(skill: "reading" | "speaking") {
    stopRecording(skill);
    if (skill === "reading") {
      setReadingAudioBlob(null);
      if (readingAudioUrl) URL.revokeObjectURL(readingAudioUrl);
      setReadingAudioUrl(null);
      setReadingFileId(null);
    } else {
      setSpeakingAudioBlob(null);
      if (speakingAudioUrl) URL.revokeObjectURL(speakingAudioUrl);
      setSpeakingAudioUrl(null);
      setSpeakingFileId(null);
    }
  }

  const bySkill = (s: Skill) => content.filter((c) => c.skill === s);

  if (loading) return <main className="p-10">Loading...</main>;

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Initial Assessment</h1>
        <Link className="underline" href="/student">Back to dashboard</Link>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {msg && <p className="mt-3 text-sm text-green-700">{msg}</p>}

      <div className="mt-6 space-y-6">
        {(["reading", "listening", "writing", "speaking"] as Skill[]).map((s) => (
          <section key={s} className="rounded border p-4">
            <h2 className="text-xl font-semibold capitalize">{s}</h2>

            <div className="mt-3 space-y-3">
              {bySkill(s).length === 0 && (
                <p className="text-sm text-gray-600">No content for this skill yet.</p>
              )}
              {bySkill(s).map((c) => (
                <div key={c.id} className="rounded border p-3">
                  <p className="font-medium">{c.title}</p>
                  {c.description && <p className="mt-1 text-sm text-gray-700">{c.description}</p>}
                  {c.textBody && (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">
                      {c.textBody}
                    </pre>
                  )}
                  {c.assetUrl && (
                    <a className="mt-2 inline-block underline" href={c.assetUrl} target="_blank" rel="noreferrer">
                      Open attached file
                    </a>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4">
              <label className="text-sm font-medium">Your response</label>

              {(s === "reading" || s === "speaking") && (() => {
                const isReading = s === "reading";
                const recording = isReading ? readingRecording : speakingRecording;
                const audioUrl = isReading ? readingAudioUrl : speakingAudioUrl;
                const audioBlob = isReading ? readingAudioBlob : speakingAudioBlob;
                const fileId = isReading ? readingFileId : speakingFileId;

                return (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      {!recording ? (
                        <button
                          type="button"
                          className="rounded border px-3 py-1 text-sm"
                          onClick={() => startRecording(s)}
                          disabled={submitting}
                        >
                          {audioBlob ? "Re-record" : "Start recording"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded border px-3 py-1 text-sm"
                          onClick={() => stopRecording(s)}
                        >
                          Stop recording
                        </button>
                      )}
                      {audioBlob && (
                        <button
                          type="button"
                          className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                          onClick={() => deleteRecording(s)}
                          disabled={submitting}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    {audioUrl && <audio controls src={audioUrl} />}
                    {fileId && (
                      <p className="text-xs text-green-700">✅ Uploaded to storage</p>
                    )}
                  </div>
                );
              })()}

              {s === "listening" && (
                <textarea
                  className="mt-2 w-full rounded border p-2 text-sm"
                  rows={4}
                  value={responses.listening}
                  onChange={(e) => setResponses((p) => ({ ...p, listening: e.target.value }))}
                  placeholder="Write what you understood from the audio..."
                  disabled={submitting}
                />
              )}
              {s === "writing" && (
                <textarea
                  className="mt-2 w-full rounded border p-2 text-sm"
                  rows={4}
                  value={responses.writing}
                  onChange={(e) => setResponses((p) => ({ ...p, writing: e.target.value }))}
                  placeholder="Write your answer here..."
                  disabled={submitting}
                />
              )}
            </div>
          </section>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="mt-6 rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit Assessment"}
      </button>
    </main>
  );
}