"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/fetchWithAuth";

type RenewalRow = {
  id: string;
  method: string;
  status: string;
  transactionId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  child: {
    id: string;
    childFirstName: string;
    childLastName: string;
    grade: number;
    status: string;
    subscriptionExpiresAt: string | null;
    parent: { firstName: string; lastName: string; email: string; phone: string };
  };
  receiptFile: { id: string; originalName: string; mimeType: string } | null;
  reviewedByAdmin: { firstName: string | null; lastName: string | null; email: string } | null;
};

type BillingConfig = {
  cycleDays: number;
  gracePeriodDays: number;
  renewalWindowDays: number;
  monthlyFee: string | null;
  currency: string;
};

export default function AdminSubscriptionsPage() {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [renewals, setRenewals] = useState<RenewalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [configExists, setConfigExists] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);
  const [configForm, setConfigForm] = useState<BillingConfig>({
    cycleDays: 30, gracePeriodDays: 7, renewalWindowDays: 7, monthlyFee: null, currency: "USD",
  });
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  async function loadRenewals() {
    setLoading(true);
    setMsg(null);
    const res = await adminFetch(`/api/admin/subscriptions?status=${tab}`);
    const data = await res.json();
    setRenewals(data.renewals ?? []);
    setLoading(false);
  }

  async function loadConfig() {
    const res = await adminFetch("/api/admin/billing-config");
    if (!res.ok) return;
    const data = await res.json();
    setConfig(data.config);
    setConfigExists(data.exists);
    setConfigForm(data.config);
  }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setMsg(null);
      const res = await adminFetch(`/api/admin/subscriptions?status=${tab}`);
      const data = await res.json();
      if (cancelled) return;
      setRenewals(data.renewals ?? []);
      setLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await adminFetch("/api/admin/billing-config");
      if (cancelled || !res.ok) return;
      const data = await res.json();
      setConfig(data.config);
      setConfigExists(data.exists);
      setConfigForm(data.config);
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  async function approve(id: string) {
    setMsg(null);
    const res = await adminFetch(`/api/admin/subscriptions/${id}/approve`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error ?? "Approve failed"); return; }
    setMsg("Renewal approved.");
    loadRenewals();
  }

  async function reject(id: string) {
    setMsg(null);
    const reason = (rejectReasons[id] ?? "").trim();
    const res = await adminFetch(`/api/admin/subscriptions/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error ?? "Reject failed"); return; }
    setMsg("Renewal rejected.");
    setRejectReasons(prev => { const n = { ...prev }; delete n[id]; return n; });
    loadRenewals();
  }

  async function saveConfig() {
    setSavingConfig(true);
    setConfigMsg(null);
    const res = await adminFetch("/api/admin/billing-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cycleDays:         Number(configForm.cycleDays),
        gracePeriodDays:   Number(configForm.gracePeriodDays),
        renewalWindowDays: Number(configForm.renewalWindowDays),
        monthlyFee:        configForm.monthlyFee ? Number(configForm.monthlyFee) : null,
        currency:          configForm.currency,
      }),
    });
    const data = await res.json();
    setSavingConfig(false);
    if (!res.ok) { setConfigMsg(data.error ?? "Save failed"); return; }
    setConfigMsg("Billing config saved.");
    setEditingConfig(false);
    loadConfig();
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  const daysUntil = (iso: string) => {
    const diff = new Date(iso).getTime() - Date.now();
    return Math.ceil(diff / 86_400_000);
  };

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Subscriptions</h1>
      <Link className="underline text-sm" href="/admin">Back to admin dashboard</Link>

      {/* Tabs */}
      <div className="mt-6 flex gap-2">
        {(["pending", "approved", "rejected"] as const).map((t) => (
          <button
            key={t}
            className={`rounded px-4 py-1.5 text-sm font-medium capitalize ${tab === t ? "bg-black text-white" : "border"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <button className="ml-2 rounded border px-3 py-1.5 text-sm" onClick={loadRenewals} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {msg && <p className="mt-3 text-sm font-medium">{msg}</p>}

      {/* Renewal list */}
      <div className="mt-4 space-y-3">
        {renewals.length === 0 && !loading && (
          <p className="text-sm text-gray-600">No {tab} renewals.</p>
        )}

        {renewals.map((r) => {
          const expiry = r.child.subscriptionExpiresAt;
          const days = expiry ? daysUntil(expiry) : null;
          const newPeriodEnd = expiry
            ? new Date(new Date(expiry).getTime() + (config?.cycleDays ?? 30) * 86_400_000)
            : null;

          return (
            <div key={r.id} className="rounded border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="font-medium">
                    {r.child.childFirstName} {r.child.childLastName} (Grade {r.child.grade})
                  </p>
                  <p className="text-sm text-gray-700">
                    Parent: {r.child.parent.firstName} {r.child.parent.lastName} —{" "}
                    {r.child.parent.email} — {r.child.parent.phone}
                  </p>
                  <p className="text-sm text-gray-700">
                    Method:{" "}
                    {r.method === "receipt_upload" && r.receiptFile ? (
                      <a
                        className="underline"
                        href={`/api/admin/receipts/${r.receiptFile.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View receipt
                      </a>
                    ) : r.transactionId ? (
                      <span>Tx: {r.transactionId}</span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">Submitted: {fmtDate(r.createdAt)}</p>
                  {expiry && (
                    <p className="text-xs text-gray-500">
                      Current expiry: {fmtDate(expiry)}
                      {days !== null && (
                        <span className={days < 0 ? " text-red-500 font-medium" : " text-gray-400"}>
                          {" "}({days < 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`})
                        </span>
                      )}
                    </p>
                  )}
                  {newPeriodEnd && tab === "pending" && (
                    <p className="text-xs text-blue-700 font-medium">
                      New period would be: {expiry ? fmtDate(expiry) : "now"} → {fmtDate(newPeriodEnd.toISOString())}
                    </p>
                  )}
                  {r.reviewedByAdmin && tab !== "pending" && (
                    <p className="text-xs text-gray-500">
                      {tab === "approved" ? "Approved" : "Rejected"} by{" "}
                      {r.reviewedByAdmin.firstName ?? r.reviewedByAdmin.email}
                      {r.reviewedAt ? ` on ${fmtDate(r.reviewedAt)}` : ""}
                    </p>
                  )}
                </div>

                {tab === "pending" && (
                  <div className="flex flex-col gap-2 min-w-[240px]">
                    <textarea
                      className="w-full rounded border px-3 py-2 text-sm"
                      placeholder="Reject reason (optional)"
                      rows={2}
                      value={rejectReasons[r.id] ?? ""}
                      onChange={(e) => setRejectReasons(prev => ({ ...prev, [r.id]: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <button
                        className="rounded bg-black px-3 py-1 text-sm text-white"
                        onClick={() => approve(r.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="rounded border px-3 py-1 text-sm"
                        onClick={() => reject(r.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Billing Config */}
      <div className="mt-10 rounded border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Billing Config</h2>
          {!editingConfig && (
            <button
              className="rounded border px-3 py-1 text-sm"
              onClick={() => { setEditingConfig(true); setConfigMsg(null); }}
            >
              Edit
            </button>
          )}
        </div>

        {!configExists && !editingConfig && (
          <p className="mt-2 text-sm text-gray-500">No config saved yet — showing defaults.</p>
        )}

        {!editingConfig && config && (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex gap-4">
              <dt className="w-48 text-gray-500">Cycle length</dt>
              <dd>{config.cycleDays} days</dd>
            </div>
            <div className="flex gap-4">
              <dt className="w-48 text-gray-500">Grace period</dt>
              <dd>{config.gracePeriodDays} days</dd>
            </div>
            <div className="flex gap-4">
              <dt className="w-48 text-gray-500">Renewal window</dt>
              <dd>{config.renewalWindowDays} days before expiry</dd>
            </div>
            <div className="flex gap-4">
              <dt className="w-48 text-gray-500">Monthly fee</dt>
              <dd>{config.monthlyFee ? `${config.currency} ${config.monthlyFee}` : "Not set"}</dd>
            </div>
          </dl>
        )}

        {editingConfig && (
          <div className="mt-4 space-y-4 max-w-sm">
            {[
              { label: "Cycle length (days)", key: "cycleDays" as const },
              { label: "Grace period (days)", key: "gracePeriodDays" as const },
              { label: "Renewal window (days before expiry)", key: "renewalWindowDays" as const },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-1">{label}</label>
                <input
                  type="number"
                  min={0}
                  className="rounded border px-3 py-2 w-full"
                  value={configForm[key] as number}
                  onChange={(e) => setConfigForm(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium mb-1">Monthly fee (display only, optional)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className="rounded border px-3 py-2 w-full"
                placeholder="e.g. 29.99"
                value={configForm.monthlyFee ?? ""}
                onChange={(e) => setConfigForm(prev => ({ ...prev, monthlyFee: e.target.value || null }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <input
                type="text"
                maxLength={10}
                className="rounded border px-3 py-2 w-full"
                value={configForm.currency}
                onChange={(e) => setConfigForm(prev => ({ ...prev, currency: e.target.value }))}
              />
            </div>

            {configMsg && <p className="text-sm">{configMsg}</p>}

            <div className="flex gap-2">
              <button
                className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={saveConfig}
                disabled={savingConfig}
              >
                {savingConfig ? "Saving…" : "Save"}
              </button>
              <button
                className="rounded border px-4 py-2 text-sm"
                onClick={() => { setEditingConfig(false); setConfigMsg(null); setConfigForm(config!); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
