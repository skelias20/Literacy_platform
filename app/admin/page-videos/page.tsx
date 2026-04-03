"use client";

// app/admin/page-videos/page.tsx
// Admin UI for managing per-page instructional video URLs.
// Each of the 4 student-facing pages (dashboard, assessment, task, registration)
// can have one optional video URL. Setting an empty URL removes the video.

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/fetchWithAuth";

type PageKey = "dashboard" | "assessment" | "task" | "registration";

const PAGE_LABELS: Record<PageKey, string> = {
  dashboard:    "Student Dashboard",
  assessment:   "Assessment Page",
  task:         "Daily Task Page",
  registration: "Registration Page",
};

const ALL_KEYS: PageKey[] = ["dashboard", "assessment", "task", "registration"];

type PageState = {
  current: string | null;
  input:   string;
  saving:  boolean;
  err:     string | null;
  saved:   boolean;
};

function defaultState(current: string | null): PageState {
  return { current, input: current ?? "", saving: false, err: null, saved: false };
}

export default function PageVideosAdminPage() {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<PageKey, PageState>>(
    () => Object.fromEntries(ALL_KEYS.map((k) => [k, defaultState(null)])) as Record<PageKey, PageState>,
  );

  // ── Load current values for all 4 pages ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadErr(null);
      const results = await Promise.all(
        ALL_KEYS.map((key) =>
          adminFetch(`/api/admin/page-videos/${key}`)
            .then((r) => r.json().catch(() => ({})))
            .then((d: { videoUrl?: string | null }) => ({ key, videoUrl: d.videoUrl ?? null })),
        ),
      );
      if (cancelled) return;
      setPages(
        Object.fromEntries(results.map(({ key, videoUrl }) => [key, defaultState(videoUrl)])) as Record<PageKey, PageState>,
      );
      setLoading(false);
    };
    run().catch((e) => {
      if (!cancelled) {
        setLoadErr(e instanceof Error ? e.message : "Failed to load");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  function updateInput(key: PageKey, value: string) {
    setPages((prev) => ({ ...prev, [key]: { ...prev[key], input: value, err: null, saved: false } }));
  }

  async function save(key: PageKey) {
    setPages((prev) => ({ ...prev, [key]: { ...prev[key], saving: true, err: null, saved: false } }));
    try {
      const res = await adminFetch(`/api/admin/page-videos/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: pages[key].input.trim() || null }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; videoUrl?: string | null; error?: string };
      if (!res.ok) {
        setPages((prev) => ({ ...prev, [key]: { ...prev[key], saving: false, err: data.error ?? "Save failed" } }));
        return;
      }
      const saved = data.videoUrl ?? null;
      setPages((prev) => ({ ...prev, [key]: { ...prev[key], saving: false, saved: true, current: saved, input: saved ?? "" } }));
    } catch (e) {
      setPages((prev) => ({ ...prev, [key]: { ...prev[key], saving: false, err: e instanceof Error ? e.message : "Save failed" } }));
    }
  }

  function clear(key: PageKey) {
    setPages((prev) => ({ ...prev, [key]: { ...prev[key], input: "", err: null, saved: false } }));
  }

  if (loading) return <main className="p-10"><p className="text-sm text-gray-600">Loading…</p></main>;
  if (loadErr) return <main className="p-10"><p className="text-sm text-red-600">{loadErr}</p></main>;

  return (
    <main className="p-10 max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Page Guidance Videos</h1>
        <Link href="/admin" className="text-sm underline text-gray-500">← Admin Home</Link>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        Optionally attach an instructional video URL to each student-facing page.
        Students see a collapsible &quot;How to complete this section&quot; banner when a URL is set.
        Clear the URL to remove the video from that page.
      </p>

      <div className="mt-6 space-y-6">
        {ALL_KEYS.map((key) => {
          const p = pages[key];
          const unchanged = p.input.trim() === (p.current ?? "");
          return (
            <div key={key} className="rounded border p-4">
              <p className="font-medium">{PAGE_LABELS[key]}</p>
              {p.current ? (
                <p className="mt-1 text-xs text-gray-500 break-all">Current: {p.current}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-400">No video set</p>
              )}

              <div className="mt-3 flex gap-2">
                <input
                  type="url"
                  value={p.input}
                  onChange={(e) => updateInput(key, e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1 rounded border px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => save(key)}
                  disabled={p.saving || unchanged}
                  className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-40"
                >
                  {p.saving ? "Saving…" : "Save"}
                </button>
                {p.input && (
                  <button
                    type="button"
                    onClick={() => clear(key)}
                    disabled={p.saving}
                    className="rounded border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Clear
                  </button>
                )}
              </div>

              {p.err && <p className="mt-2 text-xs text-red-600">{p.err}</p>}
              {p.saved && <p className="mt-2 text-xs text-green-700">Saved.</p>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
