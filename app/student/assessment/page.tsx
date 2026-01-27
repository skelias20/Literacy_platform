"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";


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

export default function StudentAssessmentPage() {
  const [assessmentId, setAssessmentId] = useState<string>("");
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);


  const [readingAudioUrl, setReadingAudioUrl] = useState<string | null>(null);
  const [readingAudioBlob, setReadingAudioBlob] = useState<Blob | null>(null);
  const [readingRecording, setReadingRecording] = useState(false);

  const [speakingAudioUrl, setSpeakingAudioUrl] = useState<string | null>(null);
  const [speakingAudioBlob, setSpeakingAudioBlob] = useState<Blob | null>(null);
  const [speakingRecording, setSpeakingRecording] = useState(false);

  const readingRecorderRef = useRef<MediaRecorder | null>(null);
  const speakingRecorderRef = useRef<MediaRecorder | null>(null);





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
      setErr(null);
      setMsg(null);

      const res = await fetch("/api/student/assessment");
      const data = await res.json().catch(() => ({}));

      if (!alive) return;

      if (!res.ok) {
        setErr(data.error ?? "Failed to load assessment.");
        setLoading(false);
        return;
      }

      setAssessmentId(data.assessmentId);
      setContent(data.content ?? []);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, []);

  const canSubmit =
    !!readingAudioBlob &&
    !!speakingAudioBlob &&
    responses.listening.trim().length > 0 &&
    responses.writing.trim().length > 0;

  async function submit() {
    setErr(null);
    setMsg(null);

    // HARD GUARD (never trust UI alone)
    if (!canSubmit) {
      setErr("Please complete all parts of the assessment before submitting.");
      return;
    }

    try {
      // 1) Upload reading audio
      await uploadAudio("reading", readingAudioBlob!);

      // 2) Upload speaking audio
      await uploadAudio("speaking", speakingAudioBlob!);

      // 3) Submit text responses (listening + writing)
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
        return;
      }

      setMsg("Submitted. Your admin will review and assign your level.");
    } catch (e: unknown) {
      const err = e as Error;
      setErr(err.message || "Submission failed.");
    }
  }

  async function uploadAudio(skill: "reading" | "speaking", blob: Blob) {
    const fd = new FormData();
    fd.append("assessmentId", assessmentId);
    fd.append("skill", skill);
    fd.append("file", new File([blob], `${skill}.webm`, { type: "audio/webm" }));

    const res = await fetch("/api/student/assessment/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Upload failed for ${skill}`);
  }


  async function startReadingRecording() {
    setErr(null);

    try {
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        setReadingAudioBlob(blob);
        setReadingAudioUrl(URL.createObjectURL(blob));
        setReadingRecording(false);
      };

      readingRecorderRef.current = recorder;
      recorder.start();
      setReadingRecording(true);
      setErr(null);
    } catch (e: unknown) {
      const err = e as DOMException;
      setReadingRecording(false);
      setErr(`Mic error: ${err.name} — ${err.message}`);
      console.log("MIC ERR", err.name, err.message, window.location.origin);
    }
  }

  function stopReadingRecording() {
    const rec = readingRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function deleteReadingRecording() {
    // stop if still recording
    stopReadingRecording();
    setReadingAudioBlob(null);
    if (readingAudioUrl) URL.revokeObjectURL(readingAudioUrl);
    setReadingAudioUrl(null);
  }

  async function startSpeakingRecording() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        setSpeakingAudioBlob(blob);
        setSpeakingAudioUrl(URL.createObjectURL(blob));
        setSpeakingRecording(false);
      };

      speakingRecorderRef.current = recorder;
      recorder.start();
      setSpeakingRecording(true);
    } catch (e: unknown) {
      const err = e as DOMException;
      setSpeakingRecording(false);
      setErr(`Mic error: ${err.name} — ${err.message}`);
      console.log("MIC ERR", err.name, err.message, window.location.origin);
    }
  }

  function stopSpeakingRecording() {
    const rec = speakingRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function deleteSpeakingRecording() {
    stopSpeakingRecording();
    setSpeakingAudioBlob(null);
    if (speakingAudioUrl) URL.revokeObjectURL(speakingAudioUrl);
    setSpeakingAudioUrl(null);
  }


  const bySkill = (s: Skill) => content.filter((c) => c.skill === s);

  if (loading) return <main className="p-10">Loading...</main>;

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Initial Assessment</h1>
        <Link className="underline" href="/student">
          Back to dashboard
        </Link>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {msg && <p className="mt-3 text-sm text-green-700">{msg}</p>}

      <div className="mt-6 space-y-6">
        {(["reading", "listening", "writing", "speaking"] as Skill[]).map((s) => (
          <section key={s} className="rounded border p-4">
            <h2 className="text-xl font-semibold capitalize">{s}</h2>

            <div className="mt-3 space-y-3">
              {bySkill(s).length === 0 && (
                <p className="text-sm text-gray-600">
                  No default content seeded for this skill yet.
                </p>
              )}

              {bySkill(s).map((c) => (
                <div key={c.id} className="rounded border p-3">
                  <p className="font-medium">{c.title}</p>
                  {c.description && (
                    <p className="mt-1 text-sm text-gray-700">{c.description}</p>
                  )}

                  {c.textBody && (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">
                      {c.textBody}
                    </pre>
                  )}

                  {c.assetUrl && (
                    <a
                      className="mt-2 inline-block underline"
                      href={c.assetUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open attached file
                    </a>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4">
              <label className="text-sm font-medium">
                Your response
              </label>

              {s === "reading" && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex gap-2">
                    {!readingRecording ? (
                      <button type="button" className="rounded border px-3 py-1 text-sm" onClick={startReadingRecording}>
                        Start recording
                      </button>
                    ) : (
                      <button type="button" className="rounded border px-3 py-1 text-sm" onClick={stopReadingRecording}>
                        Stop recording
                      </button>
                    )}

                    <button
                      type="button"
                      className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                      disabled={!readingAudioBlob}
                      onClick={deleteReadingRecording}
                    >
                      Delete recording
                    </button>
                  </div>

                  {readingAudioUrl && <audio controls src={readingAudioUrl} />}
                </div>
              )}



              {/* 🎤 SPEAKING ONLY: recording UI */}
              {s === "speaking" && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex gap-2">
                    {!speakingRecording ? (
                      <button type="button" className="rounded border px-3 py-1 text-sm" onClick={startSpeakingRecording}>
                        Start recording
                      </button>
                    ) : (
                      <button type="button" className="rounded border px-3 py-1 text-sm" onClick={stopSpeakingRecording}>
                        Stop recording
                      </button>
                    )}

                    <button
                      type="button"
                      className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                      disabled={!speakingAudioBlob}
                      onClick={deleteSpeakingRecording}
                    >
                      Delete recording
                    </button>
                  </div>

                  {speakingAudioUrl && <audio controls src={speakingAudioUrl} />}
                </div>
              )}

              {s === "listening" && (
                <textarea
                  className="mt-2 w-full rounded border p-2 text-sm"
                  rows={4}
                  value={responses.listening}
                  onChange={(e) => setResponses((prev) => ({ ...prev, listening: e.target.value }))}
                  placeholder="Write what you understood from the audio..."
                />
              )}

              {s === "writing" && (
                <textarea
                  className="mt-2 w-full rounded border p-2 text-sm"
                  rows={4}
                  value={responses.writing}
                  onChange={(e) => setResponses((prev) => ({ ...prev, writing: e.target.value }))}
                  placeholder="Write your answer here..."
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
        Submit Assessment
      </button>

    </main>
  );
}
