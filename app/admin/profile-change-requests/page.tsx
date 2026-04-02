"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type ChildInfo = {
  id: string;
  childFirstName: string;
  childLastName: string;
  grade: number;
};

type RequestSummary = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedChanges: Record<string, unknown>;
  requestedAt: string;
  reviewedAt: string | null;
  adminNote: string | null;
  child: ChildInfo;
  reviewedByAdmin: { firstName: string | null; lastName: string | null } | null;
};

type RequestDetail = RequestSummary & {
  snapshotBefore: Record<string, unknown>;
};

const FIELD_LABELS: Record<string, string> = {
  childFirstName:  "Child first name",
  childLastName:   "Child last name",
  grade:           "Grade",
  subjects:        "Favourite subjects",
  parentFirstName: "Parent first name",
  parentLastName:  "Parent last name",
  parentEmail:     "Parent email",
  parentPhone:     "Parent phone",
};

function StatusBadge({ status }: { status: RequestSummary["status"] }) {
  if (status === "PENDING")
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Pending</span>;
  if (status === "APPROVED")
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Approved</span>;
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Rejected</span>;
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ") || "—";
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export default function AdminProfileChangeRequestsPage() {
  const [requests, setRequests]     = useState<RequestSummary[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");

  const [selected, setSelected]     = useState<RequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [noteInput, setNoteInput]   = useState("");
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError]     = useState<string | null>(null);

  function loadRequests(filter: string) {
    setLoading(true);
    setError(null);
    const url = filter === "ALL"
      ? "/api/admin/profile-change-requests"
      : `/api/admin/profile-change-requests?status=${filter}`;

    let cancelled = false;
    async function run() {
      try {
        const res = await fetch(url);
        if (cancelled) return;
        if (!res.ok) { setError("Failed to load requests."); setLoading(false); return; }
        const { requests: r } = await res.json();
        if (!cancelled) { setRequests(r); setLoading(false); }
      } catch {
        if (!cancelled) { setError("Network error."); setLoading(false); }
      }
    }
    run();
    return () => { cancelled = true; };
  }

  useEffect(() => {
    const cleanup = loadRequests(statusFilter);
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    setSelected(null);
    setConfirming(null);
    setNoteInput("");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/profile-change-requests/${id}`);
      const { request } = await res.json();
      setSelected(request);
    } catch {
      setActionError("Failed to load request detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitReview(action: "approve" | "reject") {
    if (!selected) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/profile-change-requests/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, adminNote: noteInput.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Failed.");
      } else {
        setSelected(null);
        setConfirming(null);
        loadRequests(statusFilter);
      }
    } catch {
      setActionError("Network error.");
    } finally {
      setActionLoading(false);
    }
  }

  const pendingCount = requests.filter((r) => r.status === "PENDING").length;

  return (
    <main className="p-10">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">← Admin</Link>
        <h1 className="text-2xl font-bold">Profile Change Requests</h1>
        {statusFilter === "PENDING" && pendingCount > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-800">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {(["PENDING", "APPROVED", "REJECTED", "ALL"] as const).map((f) => (
          <button
            key={f}
            onClick={() => { setStatusFilter(f); setSelected(null); }}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="flex gap-6">
        {/* Request list */}
        <div className="w-80 shrink-0">
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && requests.length === 0 && (
            <p className="text-sm text-gray-500">No requests found.</p>
          )}
          <div className="space-y-2">
            {requests.map((r) => (
              <button
                key={r.id}
                onClick={() => openDetail(r.id)}
                className={`w-full text-left rounded border p-3 transition-colors hover:bg-gray-50 ${
                  selected?.id === r.id ? "border-black bg-gray-50" : "border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">
                    {r.child.childFirstName} {r.child.childLastName}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-gray-500">Grade {r.child.grade}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {Object.keys(r.requestedChanges).map((k) => FIELD_LABELS[k] ?? k).join(", ")}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(r.requestedAt).toLocaleDateString()}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0">
          {detailLoading && <p className="text-sm text-gray-500">Loading…</p>}

          {!detailLoading && !selected && (
            <div className="rounded border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
              Select a request to review
            </div>
          )}

          {selected && (
            <div className="rounded border p-5 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-lg">
                    {selected.child.childFirstName} {selected.child.childLastName}
                  </p>
                  <p className="text-sm text-gray-500">
                    Grade {selected.child.grade} ·{" "}
                    <Link
                      href={`/admin/students?id=${selected.child.id}`}
                      className="underline hover:text-black"
                    >
                      View student
                    </Link>
                  </p>
                </div>
                <StatusBadge status={selected.status} />
              </div>

              {/* Before / After diff table */}
              <div>
                <p className="text-sm font-semibold text-gray-600 mb-2">Requested changes</p>
                <table className="w-full text-sm border rounded overflow-hidden">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-3 py-2 font-medium text-gray-600 w-40">Field</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Current value</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Requested value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(selected.requestedChanges).map(([k, newVal]) => {
                      const oldVal = (selected.snapshotBefore as Record<string, unknown>)[k];
                      return (
                        <tr key={k} className="border-t">
                          <td className="px-3 py-2 text-gray-500">{FIELD_LABELS[k] ?? k}</td>
                          <td className="px-3 py-2 text-gray-700">{formatValue(oldVal)}</td>
                          <td className="px-3 py-2 font-medium text-black">{formatValue(newVal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-400">
                Submitted {new Date(selected.requestedAt).toLocaleString()}
                {selected.reviewedAt && ` · Reviewed ${new Date(selected.reviewedAt).toLocaleString()}`}
                {selected.reviewedByAdmin && (
                  <> by {selected.reviewedByAdmin.firstName} {selected.reviewedByAdmin.lastName}</>
                )}
              </p>

              {selected.adminNote && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Admin note:</span> {selected.adminNote}
                </p>
              )}

              {/* Review actions — only for PENDING */}
              {selected.status === "PENDING" && (
                <div className="space-y-3 pt-2 border-t">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Note (optional — shown to student on rejection)
                    </label>
                    <input
                      className="w-full rounded border px-3 py-2 text-sm"
                      placeholder="Add a note…"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      maxLength={500}
                    />
                  </div>

                  {!confirming && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => setConfirming("approve")}
                        className="rounded bg-green-700 px-4 py-2 text-sm text-white hover:bg-green-800"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setConfirming("reject")}
                        className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
                      >
                        Reject
                      </button>
                    </div>
                  )}

                  {confirming === "approve" && (
                    <div className="rounded border border-green-300 bg-green-50 p-3 space-y-2">
                      <p className="text-sm font-medium text-green-900">
                        Confirm: apply these changes to the student&apos;s profile now?
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => submitReview("approve")}
                          disabled={actionLoading}
                          className="rounded bg-green-700 px-4 py-1.5 text-sm text-white disabled:opacity-50"
                        >
                          {actionLoading ? "Applying…" : "Confirm approve"}
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="rounded border px-4 py-1.5 text-sm text-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {confirming === "reject" && (
                    <div className="rounded border border-red-200 bg-red-50 p-3 space-y-2">
                      <p className="text-sm font-medium text-red-900">
                        Confirm: reject this change request?
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => submitReview("reject")}
                          disabled={actionLoading}
                          className="rounded bg-red-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
                        >
                          {actionLoading ? "Rejecting…" : "Confirm reject"}
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="rounded border px-4 py-1.5 text-sm text-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {actionError && (
                    <p className="text-sm text-red-600">{actionError}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
