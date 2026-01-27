"use client";

import { useEffect, useState } from "react";

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

export default function AdminPaymentsPage() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(
    "pending"
  );
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});


  async function load() {
    setLoading(true);
    setMsg(null);
    const res = await fetch(`/api/admin/payments?status=${status}`);
    const data = await res.json();
    setPayments(data.payments ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function approve(id: string) {
    setMsg(null);
    const res = await fetch(`/api/admin/payments/${id}/approve`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? "Approve failed");
      return;
    }
    setMsg("Approved.");
    load();
  }

  async function reject(id: string) {
    setMsg(null);
    const reason = (rejectReasons[id] ?? "").trim();
  
    const res = await fetch(`/api/admin/payments/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? "Reject failed");
      return;
    }
  
    setMsg("Rejected.");
    setRejectReasons((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    load();
  }
  

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Payments</h1>

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
                  {p.child.childFirstName} {p.child.childLastName} (Grade{" "}
                  {p.child.grade})
                </p>
                <p className="text-sm text-gray-700">
                  Parent: {p.child.parent.firstName} {p.child.parent.lastName} —{" "}
                  {p.child.parent.email} — {p.child.parent.phone}
                </p>
                <p className="text-sm text-gray-700">
                  Method: {p.method === "receipt_upload" && p.receiptFile ? (
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
                  Created: {new Date(p.createdAt).toLocaleString()}
                </p>
              </div>

              {status === "pending" && (
  <div className="flex flex-col gap-2 min-w-[260px]">
    <textarea
      className="w-full rounded border px-3 py-2 text-sm"
      placeholder="Reject reason (optional)"
      value={rejectReasons[p.id] ?? ""}
      onChange={(e) =>
        setRejectReasons((prev) => ({ ...prev, [p.id]: e.target.value }))
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
          </div>
        ))}
      </div>
    </main>
  );
}
