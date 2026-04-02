"use client";

// components/UnknownWordSaver.tsx
// Collapsible panel that lets students capture unknown words while doing tasks or assessments.
// Lazy-loads the student's most recent words on first open so they can see what they've already saved.
// All words are stored server-side — persisted across sessions.
//
// Usage:
//   <UnknownWordSaver source="assessment" />
//   <UnknownWordSaver source="daily_task" />

import { useEffect, useRef, useState } from "react";
import { studentFetch } from "@/lib/fetchWithAuth";

type UnknownWordSource = "assessment" | "daily_task" | "manual";

type SavedWord = {
  id: string;
  word: string;
  source: UnknownWordSource;
  note: string | null;
  createdAt: string;
};

interface Props {
  source: "assessment" | "daily_task";
}

export default function UnknownWordSaver({ source }: Props) {
  const [expanded,  setExpanded]  = useState(false);
  const [words,     setWords]     = useState<SavedWord[]>([]);
  const [inputWord, setInputWord] = useState("");
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState<string | null>(null);

  const inputRef     = useRef<HTMLInputElement>(null);
  // Guard so we only fire the initial load once, even if the panel is opened and closed.
  const hasLoadedRef = useRef(false);

  // Lazy-load the student's most recent words the first time the panel opens.
  useEffect(() => {
    if (!expanded || hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      const res  = await studentFetch("/api/student/unknown-words?limit=10&offset=0");
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (res.ok) setWords((data as { words: SavedWord[] }).words ?? []);
      setLoading(false);
    };

    run().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [expanded]);

  // Move focus into the input whenever the panel opens.
  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  async function saveWord() {
    const trimmed = inputWord.trim().toLowerCase();
    if (!trimmed) return;

    // Local optimistic duplicate check — avoids a round-trip for obvious repeats.
    if (words.some((w) => w.word === trimmed)) {
      setInputWord("");
      return;
    }

    setSaving(true);
    setErr(null);

    const res  = await studentFetch("/api/student/unknown-words", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ word: trimmed, source }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setErr((data as { error?: string }).error ?? "Failed to save word.");
      return;
    }

    setWords((prev) => [(data as { word: SavedWord }).word, ...prev]);
    setInputWord("");
  }

  async function removeWord(id: string) {
    // Optimistic removal — revert on failure.
    setWords((prev) => prev.filter((w) => w.id !== id));

    const res = await studentFetch(`/api/student/unknown-words/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // Re-fetch authoritative state if delete failed.
      const refetch = await studentFetch("/api/student/unknown-words?limit=10&offset=0");
      const data    = await refetch.json().catch(() => ({}));
      if (refetch.ok) setWords((data as { words: SavedWord[] }).words ?? []);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); saveWord(); }
  }

  return (
    <div className="mt-6 rounded border border-gray-200 bg-gray-50">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900"
      >
        <span className="font-medium">📝 Save unknown words</span>
        <span className="text-xs text-gray-400">{expanded ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 pb-4 pt-3">
          <p className="mb-3 text-xs text-gray-500">
            Type any word you don&apos;t know. Look them up in a dictionary later on your word list.
          </p>

          {/* Input row */}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputWord}
              onChange={(e) => setInputWord(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a word and press Enter..."
              maxLength={100}
              disabled={saving}
              className="flex-1 rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={saveWord}
              disabled={saving || !inputWord.trim()}
              className="rounded bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}

          {/* Saved word chips */}
          {loading && (
            <p className="mt-3 text-xs text-gray-400">Loading saved words…</p>
          )}

          {!loading && words.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {words.map((w) => (
                <span
                  key={w.id}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-xs text-gray-700"
                >
                  {w.word}
                  <button
                    type="button"
                    onClick={() => removeWord(w.id)}
                    className="ml-0.5 text-gray-400 hover:text-red-500"
                    aria-label={`Remove "${w.word}"`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {!loading && words.length === 0 && hasLoadedRef.current && (
            <p className="mt-3 text-xs text-gray-400">No words saved yet.</p>
          )}

          {/* Link to full word list — hidden during assessment to avoid navigation away */}
          {source !== "assessment" && (
            <p className="mt-3 text-xs text-gray-400">
              <a href="/student/words" className="underline hover:text-gray-600">
                View all saved words →
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
