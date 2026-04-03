"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { studentFetch } from "@/lib/fetchWithAuth";

type BillingInfo = {
  monthlyFee: string | null;
  currency: string;
  pendingRenewal: { id: string } | null;
};

export default function StudentRenewPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [method, setMethod] = useState<"receipt_upload" | "transaction_id">("receipt_upload");
  const [txId, setTxId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await studentFetch("/api/student/subscription");
      if (cancelled) return;
      if (!res.ok) return;
      const json = await res.json();
      setBilling({ monthlyFee: json.monthlyFee, currency: json.currency, pendingRenewal: json.pendingRenewal });
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    setMsg(null);
    if (method === "transaction_id" && !txId.trim()) {
      setMsg("Transaction ID is required.");
      return;
    }
    if (method === "receipt_upload" && !file) {
      setMsg("Please select a receipt file.");
      return;
    }

    let receiptFileId: string | undefined;

    if (method === "receipt_upload" && file) {
      setUploading(true);
      // Step 1 — presign
      const presignRes = await studentFetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "renewal_receipt",
          mimeType: file.type,
          byteSize: file.size,
          originalName: file.name,
        }),
      });
      if (!presignRes.ok) {
        const d = await presignRes.json();
        setMsg(d.error ?? "Failed to prepare upload.");
        setUploading(false);
        return;
      }
      const { presignedUrl, fileId } = await presignRes.json();

      // Step 2 — PUT directly to R2
      const putRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        setMsg("Upload to storage failed. Please try again.");
        setUploading(false);
        return;
      }

      // Step 3 — confirm
      const confirmRes = await studentFetch("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, context: "renewal_receipt" }),
      });
      if (!confirmRes.ok) {
        const d = await confirmRes.json();
        setMsg(d.error ?? "Upload confirmation failed.");
        setUploading(false);
        return;
      }
      receiptFileId = fileId;
      setUploading(false);
    }

    setSubmitting(true);
    const body: Record<string, string> = { method };
    if (method === "receipt_upload" && receiptFileId) body.receiptFileId = receiptFileId;
    if (method === "transaction_id") body.transactionId = txId.trim();

    const res = await studentFetch("/api/student/subscription/renew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setMsg(data.error ?? "Submission failed.");
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <main className="p-10 max-w-xl">
        <h1 className="text-3xl font-bold">Renewal Submitted</h1>
        <div className="mt-6 rounded border border-green-200 bg-green-50 p-5">
          <p className="font-medium text-green-900">Your renewal payment has been submitted.</p>
          <p className="mt-2 text-sm text-green-800">
            The admin will review your payment and extend your subscription.
            Your current access continues until your grace period ends.
          </p>
        </div>
        <button
          className="mt-5 rounded bg-black px-4 py-2 text-white"
          onClick={() => router.push("/student/subscription")}
        >
          Back to Subscription
        </button>
      </main>
    );
  }

  const busy = uploading || submitting;

  return (
    <main className="p-10 max-w-xl">
      <h1 className="text-3xl font-bold">Renew Subscription</h1>
      <p className="mt-1 text-sm text-gray-500">
        <a className="underline" href="/student/subscription">Back</a>
      </p>

      {billing?.monthlyFee && (
        <div className="mt-6 rounded border p-4">
          <p className="text-sm text-gray-600">Monthly fee</p>
          <p className="text-2xl font-bold mt-1">
            {billing.currency} {billing.monthlyFee}
          </p>
        </div>
      )}

      {billing?.pendingRenewal && (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            You already have a pending renewal awaiting admin review.
          </p>
        </div>
      )}

      {!billing?.pendingRenewal && (
        <div className="mt-6 space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1">Payment method</label>
            <select
              className="rounded border px-3 py-2 w-full"
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
            >
              <option value="receipt_upload">Receipt upload</option>
              <option value="transaction_id">Transaction ID</option>
            </select>
          </div>

          {method === "receipt_upload" && (
            <div>
              <label className="block text-sm font-medium mb-1">Receipt file</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="block text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-gray-500">JPG, PNG, WEBP or PDF — max 5 MB</p>
            </div>
          )}

          {method === "transaction_id" && (
            <div>
              <label className="block text-sm font-medium mb-1">Transaction ID</label>
              <input
                type="text"
                className="rounded border px-3 py-2 w-full"
                placeholder="Enter your transaction reference"
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
              />
            </div>
          )}

          {msg && <p className="text-sm text-red-600">{msg}</p>}

          <button
            className="rounded bg-black px-5 py-2 text-white font-medium disabled:opacity-50"
            onClick={submit}
            disabled={busy}
          >
            {uploading ? "Uploading…" : submitting ? "Submitting…" : "Submit Renewal"}
          </button>
        </div>
      )}
    </main>
  );
}
