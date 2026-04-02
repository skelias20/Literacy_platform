"use client";

// app/student/words/page.tsx
// Full vocabulary list — paginated, sortable by date.
// Students can add words manually and delete any saved word.
// Future: definition lookup will be added per-word without layout changes.

import { useEffect, useState } from "react";
import Link from "next/link";
import { studentFetch } from "@/lib/fetchWithAuth";

type UnknownWordSource = "assessment" | "daily_task" | "manual";

type SavedWord = {
  id: string;
  word: string;
  source: UnknownWordSource;
  note: string | null;
  createdAt: string;
};

const SOURCE_LABELS: Record<UnknownWordSource, string> = {
  assessment: "Assessment",
  daily_task: "Daily Task",
  manual:     "Manual",
};

const PAGE_SIZE = 20;

export default function UnknownWordsPage() {
  const [words,       setWords]       = useState<SavedWord[]>([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err,         setErr]         = useState<string | null>(null);

  // Add-word form
  const [inputWord, setInputWord] = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState<string | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      const res  = await studentFetch(`/api/student/unknown-words?limit=${PAGE_SIZE}&offset=0`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) { setErr((data as { error?: string }).error ?? "Failed to load words."); setLoading(false); return; }
      setWords((data as { words: SavedWord[] }).words ?? []);
      setTotal((data as { total: number }).total ?? 0);
      setLoading(false);
    };

    run().catch((e) => {
      if (!cancelled) {
        console.error("[words page load]", e);
        setErr("Failed to load words.");
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, []);

  // ── Load more (pagination) ────────────────────────────────────────────
  async function loadMore() {
    setLoadingMore(true);
    const res  = await studentFetch(
      `/api/student/unknown-words?limit=${PAGE_SIZE}&offset=${words.length}`
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setWords((prev) => [...prev, ...((data as { words: SavedWord[] }).words ?? [])]);
      setTotal((data as { total: number }).total ?? total);
    }
    setLoadingMore(false);
  }

  // ── Add word ─────────────────────────────────────────────────────────
  async function addWord() {
    const trimmed = inputWord.trim().toLowerCase();
    if (!trimmed) return;

    setSaving(true);
    setSaveErr(null);

    const res  = await studentFetch("/api/student/unknown-words", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ word: trimmed, source: "manual" }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) { setSaveErr((data as { error?: string }).error ?? "Failed to save word."); return; }

    const { word: saved, created } = data as { word: SavedWord; created: boolean };

    // Prepend to list only if it was genuinely new (upsert returns existing row otherwise).
    if (created) {
      setWords((prev) => [saved, ...prev]);
      setTotal((t) => t + 1);
    }
    setInputWord("");
  }

  // ── Remove word ───────────────────────────────────────────────────────
  async function removeWord(id: string) {
    // Optimistic removal.
    setWords((prev) => prev.filter((w) => w.id !== id));
    setTotal((t) => Math.max(0, t - 1));

    const res = await studentFetch(`/api/student/unknown-words/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // Revert to authoritative server state on failure.
      const refetch = await studentFetch(
        `/api/student/unknown-words?limit=${PAGE_SIZE}&offset=0`
      );
      const data = await refetch.json().catch(() => ({}));
      if (refetch.ok) {
        setWords((data as { words: SavedWord[] }).words ?? []);
        setTotal((data as { total: number }).total ?? 0);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); addWord(); }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <main className="p-10 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">My Unknown Words</h1>
        <Link href="/student" className="text-sm underline text-gray-500">
          ← Dashboard
        </Link>
      </div>

      {/* Study tip */}
      <div className="mt-4 rounded border border-blue-100 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-800">Study tip 💡</p>
        <p className="mt-1 text-sm text-blue-700">
          Look up each word in a dictionary to learn its meaning, pronunciation, and example
          sentences. Try writing your own sentence with each word — that&apos;s the fastest way
          to remember it!
        </p>
      </div>

      {/* Add word form */}
      <div className="mt-6">
        <p className="mb-2 text-sm font-medium text-gray-700">Add a word</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputWord}
            onChange={(e) => setInputWord(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a word and press Enter..."
            maxLength={100}
            disabled={saving}
            className="flex-1 rounded border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={addWord}
            disabled={saving || !inputWord.trim()}
            className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
        {saveErr && <p className="mt-1 text-xs text-red-600">{saveErr}</p>}
      </div>

      {/* Word list */}
      <div className="mt-6">
        {loading && <p className="text-sm text-gray-500">Loading your words…</p>}

        {!loading && err && <p className="text-sm text-red-600">{err}</p>}

        {!loading && !err && words.length === 0 && (
          <div className="rounded border p-8 text-center">
            <p className="text-gray-500">You haven&apos;t saved any unknown words yet.</p>
            <p className="mt-2 text-sm text-gray-400">
              While doing assessments or daily tasks, open the
              &quot;Save unknown words&quot; panel to capture words you don&apos;t know.
            </p>
          </div>
        )}

        {!loading && !err && words.length > 0 && (
          <>
            <p className="mb-3 text-xs text-gray-500">
              {total} word{total !== 1 ? "s" : ""} saved
            </p>

            <div className="space-y-2">
              {words.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between rounded border px-4 py-3"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">{w.word}</span>
                    <span className="ml-3 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      {SOURCE_LABELS[w.source]}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(w.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day:   "numeric",
                        year:  "numeric",
                      })}
                    </span>
                    {w.note && (
                      <p className="mt-0.5 truncate text-xs italic text-gray-500">{w.note}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWord(w.id)}
                    className="ml-4 shrink-0 rounded px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remove "${w.word}"`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {words.length < total && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-4 w-full rounded border py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore
                  ? "Loading…"
                  : `Load more (${total - words.length} remaining)`}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
