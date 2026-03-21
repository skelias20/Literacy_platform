// app/admin/students/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/fetchWithAuth";

// ── Types ─────────────────────────────────────────────────────────────────

type Status =
  | "pending_payment"
  | "approved_pending_login"
  | "assessment_required"
  | "pending_level_review"
  | "active"
  | "rejected";

type Level = "foundational" | "functional" | "transitional" | "advanced" | null;

type StudentCard = {
  id: string;
  childFirstName: string;
  childLastName: string;
  grade: number;
  status: Status;
  level: Level;
  username: string | null;
  createdAt: string;
  archivedAt: string | null;
  totalRp: number;
  parent: { firstName: string; lastName: string };
};

type StudentDetail = {
  id: string;
  childFirstName: string;
  childLastName: string;
  grade: number;
  dateOfBirth: string;
  username: string | null;
  status: Status;
  level: Level;
  subjects: string[];
  createdAt: string;
  updatedAt: string;
  credentialsCreatedAt: string | null;
  levelAssignedAt: string | null;
  lastDailySubmissionAt: string | null;
  archivedAt: string | null;
  totalRp: number;
  parent: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
};

// ── Constants ─────────────────────────────────────────────────────────────

const LEVELS: Level[] = ["foundational", "functional", "transitional", "advanced"];

const STATUS_LABELS: Record<Status, string> = {
  pending_payment:       "Pending Payment",
  approved_pending_login:"Pending Login",
  assessment_required:   "Assessment Required",
  pending_level_review:  "Pending Review",
  active:                "Active",
  rejected:              "Rejected",
};

const STATUS_COLORS: Record<Status, string> = {
  pending_payment:        "bg-yellow-50 text-yellow-700 border-yellow-200",
  approved_pending_login: "bg-blue-50 text-blue-700 border-blue-200",
  assessment_required:    "bg-orange-50 text-orange-700 border-orange-200",
  pending_level_review:   "bg-purple-50 text-purple-700 border-purple-200",
  active:                 "bg-green-50 text-green-700 border-green-200",
  rejected:               "bg-red-50 text-red-700 border-red-200",
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function age(dateStr: string): number {
  const dob = new Date(dateStr);
  const now = new Date();
  let a = now.getFullYear() - dob.getFullYear();
  if (
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())
  ) a--;
  return a;
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function AdminStudentsPage() {
  const [students, setStudents]       = useState<StudentCard[]>([]);
  const [loading, setLoading]         = useState(true);
  const [err, setErr]                 = useState<string | null>(null);

  // Filters and sort (client-side after initial load)
  const [search, setSearch]           = useState("");
  const [levelFilter, setLevelFilter] = useState<Level | "all">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort]               = useState<"name" | "grade" | "status" | "level" | "createdAt" | "rp">("name");
  const [order, setOrder]             = useState<"asc" | "desc">("asc");

  // Detail panel
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [detail, setDetail]           = useState<StudentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr]     = useState<string | null>(null);

  // Edit state
  const [editing, setEditing]         = useState(false);
  const [editForm, setEditForm]       = useState<Partial<{
    childFirstName: string;
    childLastName: string;
    grade: number;
    dateOfBirth: string;
    subjects: string[];
    parentFirstName: string;
    parentLastName: string;
    parentEmail: string;
    parentPhone: string;
  }>>({});
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState<string | null>(null);

  // Reset password state
  const [showReset, setShowReset]         = useState(false);
  const [resetCustomPw, setResetCustomPw] = useState("");
  const [resetLoading, setResetLoading]   = useState(false);
  const [resetResult, setResetResult]     = useState<string | null>(null);
  const [resetErr, setResetErr]           = useState<string | null>(null);

  // Archive state
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveErr, setArchiveErr]         = useState<string | null>(null);

  // ── Load list ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setErr(null);
      // Send sort/order to API for DB-level sorting where possible.
      // Level filter and search are also handled server-side via the API.
      const qs = new URLSearchParams({ sort, order });
      if (search.trim()) qs.set("search", search.trim());
      if (showArchived) qs.set("showArchived", "true");
      const res = await adminFetch(`/api/admin/students?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) { setErr(data.error ?? "Failed to load."); setLoading(false); return; }
      setStudents(data.students ?? []);
      setLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, [sort, order, search, showArchived]);

  // ── Client-side level filter (instant, no round trip) ───────────────────
  const filtered = useMemo(() => {
    if (levelFilter === "all") return students;
    return students.filter((s) => s.level === levelFilter);
  }, [students, levelFilter]);

  // ── Load detail ─────────────────────────────────────────────────────────
  async function openDetail(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailErr(null);
    setEditing(false);
    setSaveMsg(null);
    setShowReset(false);
    setResetCustomPw("");
    setResetResult(null);
    setResetErr(null);
    setArchiveErr(null);
    setDetailLoading(true);

    const res = await adminFetch(`/api/admin/students/${id}`);
    const data = await res.json().catch(() => ({}));
    setDetailLoading(false);
    if (!res.ok) { setDetailErr(data.error ?? "Failed to load."); return; }
    setDetail(data.child);
  }

  function startEdit() {
    if (!detail) return;
    setEditForm({
      childFirstName:  detail.childFirstName,
      childLastName:   detail.childLastName,
      grade:           detail.grade,
      dateOfBirth:     detail.dateOfBirth.slice(0, 10),
      subjects:        detail.subjects,
      parentFirstName: detail.parent.firstName,
      parentLastName:  detail.parent.lastName,
      parentEmail:     detail.parent.email,
      parentPhone:     detail.parent.phone,
    });
    setEditing(true);
    setSaveMsg(null);
  }

  async function saveEdit() {
    if (!detail) return;
    setSaving(true);
    setSaveMsg(null);

    const payload: Record<string, unknown> = {};
    if (editForm.childFirstName !== detail.childFirstName)
      payload.childFirstName = editForm.childFirstName;
    if (editForm.childLastName !== detail.childLastName)
      payload.childLastName = editForm.childLastName;
    if (editForm.grade !== detail.grade)
      payload.grade = Number(editForm.grade);
    if (editForm.dateOfBirth && editForm.dateOfBirth !== detail.dateOfBirth.slice(0, 10))
      payload.dateOfBirth = editForm.dateOfBirth;
    // Subjects: compare as sorted joined strings to detect changes
    const origSubjects = [...(detail.subjects ?? [])].sort().join(",");
    const newSubjects  = [...(editForm.subjects ?? [])].sort().join(",");
    if (origSubjects !== newSubjects)
      payload.subjects = editForm.subjects ?? [];
    if (editForm.parentFirstName !== detail.parent.firstName)
      payload.parentFirstName = editForm.parentFirstName;
    if (editForm.parentLastName !== detail.parent.lastName)
      payload.parentLastName = editForm.parentLastName;
    if (editForm.parentEmail !== detail.parent.email)
      payload.parentEmail = editForm.parentEmail;
    if (editForm.parentPhone !== detail.parent.phone)
      payload.parentPhone = editForm.parentPhone;

    if (Object.keys(payload).length === 0) {
      setSaveMsg("No changes to save.");
      setSaving(false);
      setEditing(false);
      return;
    }

    const res = await adminFetch(`/api/admin/students/${detail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setSaveMsg(data.error ?? "Save failed.");
      return;
    }

    setSaveMsg("Saved successfully.");
    setEditing(false);
    // Refresh detail
    await openDetail(detail.id);
    // Refresh list in background
    const qs = new URLSearchParams({ sort, order });
    if (search.trim()) qs.set("search", search.trim());
    const listRes = await adminFetch(`/api/admin/students?${qs.toString()}`);
    const listData = await listRes.json().catch(() => ({}));
    if (listRes.ok) setStudents(listData.students ?? []);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setEditing(false);
    setSaveMsg(null);
    setShowReset(false);
    setResetCustomPw("");
    setResetResult(null);
    setResetErr(null);
    setArchiveErr(null);
  }

  async function handleReset() {
    if (!detail) return;
    setResetLoading(true);
    setResetResult(null);
    setResetErr(null);

    const body: Record<string, string> = {};
    if (resetCustomPw.trim()) body.password = resetCustomPw.trim();

    const res = await adminFetch(`/api/admin/students/${detail.id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setResetLoading(false);

    if (!res.ok) {
      setResetErr(data.error ?? "Reset failed.");
      return;
    }

    setResetResult(data.password);
    setResetCustomPw("");
  }

  async function handleArchive() {
    if (!detail) return;
    setArchiveLoading(true);
    setArchiveErr(null);

    const res = await adminFetch(`/api/admin/students/${detail.id}/archive`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    setArchiveLoading(false);

    if (!res.ok) {
      setArchiveErr(data.error ?? "Action failed.");
      return;
    }

    // Refresh detail so archivedAt reflects the new state
    await openDetail(detail.id);
    // Refresh list in background
    const qs = new URLSearchParams({ sort, order });
    if (search.trim()) qs.set("search", search.trim());
    if (showArchived) qs.set("showArchived", "true");
    const listRes = await adminFetch(`/api/admin/students?${qs.toString()}`);
    const listData = await listRes.json().catch(() => ({}));
    if (listRes.ok) setStudents(listData.students ?? []);
  }

  function toggleSort(field: typeof sort) {
    if (sort === field) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(field); setOrder("asc"); }
  }

  const sortIcon = (field: typeof sort) =>
    sort === field ? (order === "asc" ? " ↑" : " ↓") : "";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="flex h-screen overflow-hidden">

      {/* ── Left panel — list ─────────────────────────────────────── */}
      <div className={`flex flex-col ${selectedId ? "w-1/2 border-r" : "w-full"} overflow-hidden`}>

        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b px-6 py-4 shrink-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Students</h1>
            <p className="text-sm text-gray-500">
              {filtered.length} student{filtered.length !== 1 ? "s" : ""}
              {levelFilter !== "all" ? ` · ${levelFilter}` : ""}
            </p>
          </div>
          <Link href="/admin" className="text-sm underline text-gray-500">
            ← Admin
          </Link>
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3 shrink-0">
          <input
            className="flex-1 min-w-48 rounded border px-3 py-1.5 text-sm"
            placeholder="Search by name or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* Level filter — client side, instant */}
          <select
            className="rounded border px-2 py-1.5 text-sm"
            value={levelFilter ?? "all"}
            onChange={(e) => setLevelFilter(e.target.value === "all" ? "all" : e.target.value as Level)}
          >
            <option value="all">All levels</option>
            {LEVELS.map((l) => (
              <option key={l ?? ""} value={l ?? ""}>{l ?? "Unassigned"}</option>
            ))}
            <option value="">Unassigned</option>
          </select>

          {/* Show archived toggle */}
          <label className="ml-auto flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span className="text-gray-500">Show archived</span>
          </label>
        </div>

        {/* Sort bar */}
        <div className="flex items-center gap-1 border-b px-6 py-2 text-xs text-gray-500 shrink-0">
          <span className="mr-1 font-medium">Sort:</span>
          {(["name", "grade", "status", "level", "rp", "createdAt"] as const).map((f) => (
            <button
              key={f}
              onClick={() => toggleSort(f)}
              className={`rounded px-2 py-0.5 capitalize transition ${
                sort === f ? "bg-black text-white" : "hover:bg-gray-100"
              }`}
            >
              {f === "rp" ? "RP" : f === "createdAt" ? "Joined" : f}{sortIcon(f)}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {err && <p className="text-sm text-red-600">{err}</p>}
          {loading && <p className="text-sm text-gray-500">Loading…</p>}

          {!loading && filtered.length === 0 && (
            <p className="text-sm text-gray-500">No students found.</p>
          )}

          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => openDetail(s.id)}
              className={`w-full rounded-lg border px-4 py-3 text-left transition hover:shadow-sm ${
                selectedId === s.id ? "border-black bg-gray-50" : "hover:border-gray-300"
              } ${s.archivedAt ? "opacity-50" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">
                    {s.childFirstName} {s.childLastName}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Grade {s.grade} · {s.parent.firstName} {s.parent.lastName}
                    {s.username && ` · @${s.username}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {s.archivedAt ? (
                    <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      Archived
                    </span>
                  ) : (
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s.status]}`}>
                      {STATUS_LABELS[s.status]}
                    </span>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {s.level && (
                      <span className="capitalize">{s.level}</span>
                    )}
                    {s.status === "active" && !s.archivedAt && (
                      <span className="font-medium text-indigo-600">⭐ {s.totalRp} RP</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel — detail ──────────────────────────────────── */}
      {selectedId && (
        <div className="w-1/2 flex flex-col overflow-hidden">

          {/* Detail header */}
          <div className="flex items-center justify-between gap-4 border-b px-6 py-4 shrink-0">
            <h2 className="text-lg font-bold">
              {detail ? `${detail.childFirstName} ${detail.childLastName}` : "Loading…"}
            </h2>
            <div className="flex items-center gap-2">
              {detail && !editing && !showReset && (
                <>
                  <button
                    onClick={() => { setShowReset(true); setResetResult(null); setResetErr(null); }}
                    className="rounded border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Reset Password
                  </button>
                  <button
                    onClick={handleArchive}
                    disabled={archiveLoading}
                    className={`rounded border px-3 py-1.5 text-sm disabled:opacity-60 ${
                      detail.archivedAt
                        ? "border-green-300 text-green-700 hover:bg-green-50"
                        : "border-red-200 text-red-600 hover:bg-red-50"
                    }`}
                  >
                    {archiveLoading
                      ? "…"
                      : detail.archivedAt
                      ? "Unarchive"
                      : "Archive"}
                  </button>
                  <button
                    onClick={startEdit}
                    className="rounded bg-black px-3 py-1.5 text-sm text-white"
                  >
                    Edit
                  </button>
                </>
              )}
              {showReset && (
                <button
                  onClick={() => { setShowReset(false); setResetResult(null); setResetErr(null); setResetCustomPw(""); }}
                  className="rounded border px-3 py-1.5 text-sm"
                >
                  Cancel Reset
                </button>
              )}
              {editing && (
                <>
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => { setEditing(false); setSaveMsg(null); }}
                    className="rounded border px-3 py-1.5 text-sm"
                  >
                    Cancel
                  </button>
                </>
              )}
              <button
                onClick={closeDetail}
                className="rounded border px-3 py-1.5 text-sm text-gray-500"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Detail body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {detailLoading && <p className="text-sm text-gray-500">Loading…</p>}
            {detailErr && <p className="text-sm text-red-600">{detailErr}</p>}
            {archiveErr && <p className="text-sm text-red-600">{archiveErr}</p>}
            {saveMsg && (
              <p className={`text-sm ${saveMsg.includes("fail") || saveMsg.includes("error") ? "text-red-600" : "text-green-700"}`}>
                {saveMsg}
              </p>
            )}

            {detail && detail.archivedAt && (
              <div className="rounded border border-gray-300 bg-gray-50 px-4 py-2 text-sm text-gray-600">
                ⚠ This student was archived on {fmt(detail.archivedAt)}. They cannot log in. Click <strong>Unarchive</strong> to restore access.
              </div>
            )}

            {detail && (
              <>
                {/* ── Reset Password panel ─────────────────────────────── */}
                {showReset && (
                  <section className="rounded border border-yellow-200 bg-yellow-50 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-yellow-800">Reset Student Password</h3>
                    <p className="text-xs text-yellow-700">
                      Leave blank to generate a password automatically.
                      The new password will be shown once — communicate it to the parent via SMS.
                    </p>

                    <div>
                      <label className="text-xs font-medium text-yellow-800">
                        New password (optional — leave blank to generate)
                      </label>
                      <input
                        className="mt-1 w-full rounded border border-yellow-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                        type="text"
                        placeholder="e.g. Ocean#7731"
                        value={resetCustomPw}
                        onChange={(e) => setResetCustomPw(e.target.value)}
                        disabled={resetLoading || !!resetResult}
                      />
                    </div>

                    {!resetResult && (
                      <button
                        onClick={handleReset}
                        disabled={resetLoading}
                        className="rounded bg-yellow-600 px-4 py-1.5 text-sm text-white hover:bg-yellow-700 disabled:opacity-60"
                      >
                        {resetLoading ? "Resetting…" : "Confirm Reset"}
                      </button>
                    )}

                    {resetErr && (
                      <p className="text-sm text-red-600">{resetErr}</p>
                    )}

                    {resetResult && (
                      <div className="rounded border border-green-300 bg-green-50 p-3">
                        <p className="text-xs font-medium text-green-700 mb-1">
                          ✅ Password reset successfully. Send this to the parent via SMS:
                        </p>
                        <p className="font-mono text-lg font-bold tracking-widest text-green-800 select-all">
                          {resetResult}
                        </p>
                        <p className="mt-2 text-xs text-green-600">
                          This password will not be shown again after you close this panel.
                        </p>
                        <button
                          onClick={() => { setShowReset(false); setResetResult(null); }}
                          className="mt-3 rounded bg-green-700 px-3 py-1 text-xs text-white hover:bg-green-800"
                        >
                          Done
                        </button>
                      </div>
                    )}
                  </section>
                )}

                {/* RP badge */}
                {!showReset && detail.status === "active" && (
                  <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1.5">
                    <span className="text-sm font-bold text-indigo-700">⭐ {detail.totalRp} RP</span>
                    <span className="text-xs text-indigo-500">Reading Points</span>
                  </div>
                )}

                {/* Status + level and full detail — hidden during password reset */}
                {!showReset && (
                <>
                {/* Status + level — read-only, workflow-controlled */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                    Account Status
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_COLORS[detail.status]}`}>
                      {STATUS_LABELS[detail.status]}
                    </span>
                    {detail.level && (
                      <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium capitalize text-indigo-700">
                        {detail.level}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Status and level are controlled by the assessment workflow — not editable here.
                  </p>
                </section>

                {/* Child info */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    Student Information
                  </h3>
                  {editing ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="First Name">
                        <input className={inputCls} value={editForm.childFirstName ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, childFirstName: e.target.value }))} />
                      </Field>
                      <Field label="Last Name">
                        <input className={inputCls} value={editForm.childLastName ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, childLastName: e.target.value }))} />
                      </Field>
                      <Field label="Grade">
                        <input className={inputCls} type="number" min={1} max={8}
                          value={editForm.grade ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, grade: Number(e.target.value) }))} />
                      </Field>
                      <Field label="Date of Birth">
                        <input className={inputCls} type="date" value={editForm.dateOfBirth ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, dateOfBirth: e.target.value }))} />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Favourite Subjects">
                          <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                            {["English","Mathematics","Science","Social Studies","Arts","Music","Physical Education","Technology"].map((s) => (
                              <label key={s} className="flex items-center gap-2 cursor-pointer text-sm">
                                <input
                                  type="checkbox"
                                  checked={(editForm.subjects ?? []).includes(s)}
                                  onChange={() => setEditForm((p) => {
                                    const cur = p.subjects ?? [];
                                    return {
                                      ...p,
                                      subjects: cur.includes(s)
                                        ? cur.filter((x) => x !== s)
                                        : [...cur, s],
                                    };
                                  })}
                                />
                                {s}
                              </label>
                            ))}
                          </div>
                        </Field>
                      </div>
                    </div>
                  ) : (
                    <dl className="grid gap-2 sm:grid-cols-2">
                      <Row label="Full Name"   value={`${detail.childFirstName} ${detail.childLastName}`} />
                      <Row label="Grade"        value={`Grade ${detail.grade}`} />
                      <Row label="Date of Birth" value={`${fmt(detail.dateOfBirth)} (age ${age(detail.dateOfBirth)})`} />
                      <Row label="Username"     value={detail.username ?? "Not assigned"} />
                      <Row label="Joined"       value={fmt(detail.createdAt)} />
                      <Row label="Credentials"  value={fmt(detail.credentialsCreatedAt)} />
                      <Row label="Level assigned" value={fmt(detail.levelAssignedAt)} />
                      <Row label="Last activity"  value={fmt(detail.lastDailySubmissionAt)} />
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-gray-400">Favourite Subjects</dt>
                        <dd className="mt-0.5 flex flex-wrap gap-1">
                          {detail.subjects && detail.subjects.length > 0
                            ? detail.subjects.map((s) => (
                                <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{s}</span>
                              ))
                            : <span className="text-sm text-gray-400">None selected</span>
                          }
                        </dd>
                      </div>
                    </dl>
                  )}
                </section>

                {/* Parent info */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    Parent / Guardian
                  </h3>
                  {editing ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="First Name">
                        <input className={inputCls} value={editForm.parentFirstName ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, parentFirstName: e.target.value }))} />
                      </Field>
                      <Field label="Last Name">
                        <input className={inputCls} value={editForm.parentLastName ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, parentLastName: e.target.value }))} />
                      </Field>
                      <Field label="Email">
                        <input className={inputCls} type="email" value={editForm.parentEmail ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, parentEmail: e.target.value }))} />
                      </Field>
                      <Field label="Phone">
                        <input className={inputCls} value={editForm.parentPhone ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, parentPhone: e.target.value }))} />
                      </Field>
                    </div>
                  ) : (
                    <dl className="grid gap-2 sm:grid-cols-2">
                      <Row label="Name"  value={`${detail.parent.firstName} ${detail.parent.lastName}`} />
                      <Row label="Email" value={detail.parent.email} />
                      <Row label="Phone" value={detail.parent.phone} />
                    </dl>
                  )}
                </section>
                </> /* end !showReset */
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────

const inputCls = "w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-black";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm font-medium mt-0.5">{value}</dd>
    </div>
  );
}