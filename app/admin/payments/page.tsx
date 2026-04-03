"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/fetchWithAuth";
import Link from "next/link";

type PaymentRow = {
  id: string;
  method: string;
  status: string;
  transactionId: string | null;
  createdAt: string;
  child: {
    id: string;
    childFirstName: string;
    childLastName: string;
    grade: number;
    status: string;
    parent: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    };
  };
  receiptFile: null | { id: string; originalName: string; mimeType: string };
};

type PaymentEventRow = {
  id: string;
  eventType: string;
  statusBefore: string | null;
  statusAfter: string | null;
  method: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  admin: { firstName: string | null; lastName: string | null; email: string } | null;
};

const EVENT_LABELS: Record<string, string> = {
  PAYMENT_SUBMITTED: "Submitted",
  PAYMENT_APPROVED:  "Approved",
  PAYMENT_REJECTED:  "Rejected",
  RENEWAL_SUBMITTED: "Renewal submitted",
  RENEWAL_APPROVED:  "Renewal approved",
  RENEWAL_REJECTED:  "Renewal rejected",
};

const EVENT_COLORS: Record<string, string> = {
  PAYMENT_SUBMITTED: "bg-gray-100 text-gray-700",
  PAYMENT_APPROVED:  "bg-green-100 text-green-800",
  PAYMENT_REJECTED:  "bg-red-100 text-red-800",
  RENEWAL_SUBMITTED: "bg-blue-100 text-blue-800",
  RENEWAL_APPROVED:  "bg-green-100 text-green-800",
  RENEWAL_REJECTED:  "bg-red-100 text-red-800",
};

export default function AdminPaymentsPage() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [showEvents, setShowEvents] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<Record<string, PaymentEventRow[]>>({});
  const [eventsLoading, setEventsLoading] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setMsg(null);
    const res = await adminFetch(`/api/admin/payments?status=${status}`);
    const data = await res.json();
    setPayments(data.payments ?? []);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setMsg(null);
      const res = await adminFetch(`/api/admin/payments?status=${status}`);
      const data = await res.json();
      if (cancelled) return;
      setPayments(data.payments ?? []);
      setLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, [status]);

  async function approve(id: string) {
    setMsg(null);
    const res = await adminFetch(`/api/admin/payments/${id}/approve`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error ?? "Approve failed"); return; }
    setMsg("Approved.");
    // Invalidate cached events so history reloads fresh next time
    setEvents(prev => { const next = { ...prev }; delete next[id]; return next; });
    load();
  }

  async function reject(id: string) {
    setMsg(null);
    const reason = (rejectReasons[id] ?? "").trim();
    const res = await adminFetch(`/api/admin/payments/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error ?? "Reject failed"); return; }
    setMsg("Rejected.");
    setRejectReasons(prev => { const next = { ...prev }; delete next[id]; return next; });
    setEvents(prev => { const next = { ...prev }; delete next[id]; return next; });
    load();
  }

  async function toggleEvents(paymentId: string) {
    if (showEvents[paymentId]) {
      setShowEvents(prev => ({ ...prev, [paymentId]: false }));
      return;
    }
    setShowEvents(prev => ({ ...prev, [paymentId]: true }));
    if (events[paymentId]) return; // already loaded
    setEventsLoading(prev => ({ ...prev, [paymentId]: true }));
    const res = await adminFetch(`/api/admin/payments/${paymentId}/events`);
    const data = await res.json();
    setEvents(prev => ({ ...prev, [paymentId]: data.events ?? [] }));
    setEventsLoading(prev => ({ ...prev, [paymentId]: false }));
  }

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Payments</h1>
      <Link className="underline" href="/admin">Back to admin dashboard</Link>

      <div className="mt-4 flex items-center gap-3">
        <label className="text-sm font-medium">Status:</label>
        <select
          className="rounded border px-2 py-1"
          value={status}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "pending" || value === "approved" || value === "rejected") {
              setStatus(value);
            }
          }}
        >
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </select>

        <button
          className="rounded border px-3 py-1"
          onClick={load}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {msg && <p className="mt-3 text-sm">{msg}</p>}

      <div className="mt-6 space-y-3">
        {payments.length === 0 && (
          <p className="text-sm text-gray-600">No payments found.</p>
        )}

        {payments.map((p) => (
          <div key={p.id} className="rounded border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">
                  {p.child.childFirstName} {p.child.childLastName} (Grade {p.child.grade})
                </p>
                <p className="text-sm text-gray-700">
                  Parent: {p.child.parent.firstName} {p.child.parent.lastName} —{" "}
                  {p.child.parent.email} — {p.child.parent.phone}
                </p>
                <p className="text-sm text-gray-700">
                  Method:{" "}
                  {p.method === "receipt_upload" && p.receiptFile ? (
                    <a
                      className="underline"
                      href={`/api/admin/receipts/${p.receiptFile.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View receipt
                    </a>
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                  {p.transactionId ? ` | Tx: ${p.transactionId}` : ""}
                </p>
                <p className="text-xs text-gray-500">
                  Submitted: {new Date(p.createdAt).toLocaleString()}
                </p>
              </div>

              {status === "pending" && (
                <div className="flex flex-col gap-2 min-w-[260px]">
                  <textarea
                    className="w-full rounded border px-3 py-2 text-sm"
                    placeholder="Reject reason (optional)"
                    value={rejectReasons[p.id] ?? ""}
                    onChange={(e) =>
                      setRejectReasons(prev => ({ ...prev, [p.id]: e.target.value }))
                    }
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <button
                      className="rounded bg-black px-3 py-1 text-white"
                      onClick={() => approve(p.id)}
                    >
                      Approve
                    </button>
                    <button
                      className="rounded border px-3 py-1"
                      onClick={() => reject(p.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Event history */}
            <div className="mt-3 border-t pt-3">
              <button
                className="text-xs text-blue-600 underline"
                onClick={() => toggleEvents(p.id)}
              >
                {showEvents[p.id] ? "Hide history" : "Show history"}
              </button>

              {showEvents[p.id] && (
                <div className="mt-2">
                  {eventsLoading[p.id] ? (
                    <p className="text-sm text-gray-500">Loading...</p>
                  ) : (events[p.id] ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">No events recorded.</p>
                  ) : (
                    <ol className="space-y-2">
                      {(events[p.id] ?? []).map((ev) => {
                        const adminName = ev.admin
                          ? (ev.admin.firstName ?? ev.admin.email)
                          : null;
                        const statusChanged =
                          ev.statusBefore &&
                          ev.statusAfter &&
                          ev.statusBefore !== ev.statusAfter;
                        return (
                          <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                            <span className="text-gray-400 shrink-0 text-xs">
                              {new Date(ev.createdAt).toLocaleString()}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${EVENT_COLORS[ev.eventType] ?? "bg-gray-100 text-gray-700"}`}
                            >
                              {EVENT_LABELS[ev.eventType] ?? ev.eventType}
                            </span>
                            {statusChanged && (
                              <span className="text-gray-500 text-xs">
                                {ev.statusBefore} → {ev.statusAfter}
                              </span>
                            )}
                            {adminName && (
                              <span className="text-gray-500 text-xs">by {adminName}</span>
                            )}
                            {ev.reference && (
                              <span className="text-gray-500 text-xs">ref: {ev.reference}</span>
                            )}
                            {ev.notes && (
                              <span className="text-gray-500 text-xs italic">"{ev.notes}"</span>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
