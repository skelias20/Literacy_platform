"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { studentFetch } from "@/lib/fetchWithAuth";

type SubscriptionData = {
  subscriptionExpiresAt: string | null;
  accessState: "active" | "grace" | "locked" | "grandfathered";
  daysRemaining: number | null;
  gracePeriodDays: number;
  renewalWindowDays: number;
  monthlyFee: string | null;
  currency: string;
  pendingRenewal: { id: string; submittedAt: string } | null;
};

export default function StudentSubscriptionPage() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await studentFetch("/api/student/subscription");
      if (cancelled) return;
      if (!res.ok) {
        setError("Failed to load subscription information.");
        setLoading(false);
        return;
      }
      const json = await res.json();
      setData(json);
      setLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  const renewEnabled = (d: SubscriptionData): boolean => {
    if (d.pendingRenewal) return false;
    if (d.accessState === "grandfathered") return false;
    if (d.accessState === "grace" || d.accessState === "locked") return true;
    // Active: enable only within the renewal window
    return d.daysRemaining !== null && d.daysRemaining <= d.renewalWindowDays;
  };

  if (loading) {
    return (
      <main className="p-10">
        <p className="text-gray-500">Loading subscription information…</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="p-10">
        <p className="text-red-600">{error ?? "An error occurred."}</p>
        <Link className="mt-3 inline-block underline text-sm" href="/student">Back to dashboard</Link>
      </main>
    );
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const stateLabel: Record<SubscriptionData["accessState"], string> = {
    active:        "Active",
    grace:         "Grace Period",
    locked:        "Expired — Locked",
    grandfathered: "Active (no expiry)",
  };

  const stateBg: Record<SubscriptionData["accessState"], string> = {
    active:        "bg-green-50 text-green-800 border-green-200",
    grace:         "bg-amber-50 text-amber-800 border-amber-200",
    locked:        "bg-red-50 text-red-800 border-red-200",
    grandfathered: "bg-green-50 text-green-800 border-green-200",
  };

  const canRenew = renewEnabled(data);

  return (
    <main className="p-10 max-w-xl">
      <h1 className="text-3xl font-bold">Subscription</h1>
      <Link className="underline text-sm" href="/student">Back to dashboard</Link>

      <div className="mt-6 rounded border p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 uppercase tracking-wide font-medium">Plan</p>
          <p className="font-medium">Standard</p>
        </div>

        {data.monthlyFee !== null && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 uppercase tracking-wide font-medium">Monthly fee</p>
            <p className="font-medium">{data.currency} {data.monthlyFee}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 uppercase tracking-wide font-medium">Status</p>
          <span className={`rounded border px-2 py-0.5 text-sm font-medium ${stateBg[data.accessState]}`}>
            {stateLabel[data.accessState]}
          </span>
        </div>

        {data.subscriptionExpiresAt && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 uppercase tracking-wide font-medium">
              {data.accessState === "active" ? "Expires" : "Expired"}
            </p>
            <p className="font-medium">
              {fmtDate(data.subscriptionExpiresAt)}
              {data.daysRemaining !== null && data.accessState === "active" && (
                <span className="ml-1 text-sm text-gray-500">({data.daysRemaining} days remaining)</span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Grace / locked banners */}
      {data.accessState === "grace" && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Subscription expired</p>
          <p className="mt-1 text-sm text-amber-800">
            Your subscription expired on {fmtDate(data.subscriptionExpiresAt!)}.
            You are in a grace period. Please renew to avoid losing access.
          </p>
        </div>
      )}

      {data.accessState === "locked" && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-4">
          <p className="font-medium text-red-900">Access suspended</p>
          <p className="mt-1 text-sm text-red-800">
            Your subscription has expired and your grace period has ended.
            Renew now to continue submitting work.
          </p>
        </div>
      )}

      {/* Pending renewal notice */}
      {data.pendingRenewal && (
        <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-4">
          <p className="font-medium text-blue-900">Renewal submitted</p>
          <p className="mt-1 text-sm text-blue-800">
            Your renewal payment was submitted on{" "}
            {fmtDate(data.pendingRenewal.submittedAt)} and is awaiting admin review.
          </p>
        </div>
      )}

      {/* Renewal window notice (active, no pending) */}
      {data.accessState === "active" &&
        !data.pendingRenewal &&
        data.daysRemaining !== null &&
        data.daysRemaining <= data.renewalWindowDays && (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            Your subscription renews on {fmtDate(data.subscriptionExpiresAt!)}.
            You can submit your renewal payment now.
          </p>
        </div>
      )}

      {/* Renew button */}
      {canRenew ? (
        <Link
          href="/student/subscription/renew"
          className="mt-5 inline-block rounded bg-black px-5 py-2 text-white font-medium"
        >
          Renew Subscription
        </Link>
      ) : (
        !data.pendingRenewal && data.accessState !== "grandfathered" && (
          <button
            disabled
            className="mt-5 inline-block rounded bg-gray-200 px-5 py-2 text-gray-500 font-medium cursor-not-allowed"
            title={`Renewal opens ${data.renewalWindowDays} days before expiry`}
          >
            Renew Subscription
          </button>
        )
      )}
    </main>
  );
}
