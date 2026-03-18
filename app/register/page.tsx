"use client";

import React, { useState } from "react";

type PaymentMethod = "transaction_id" | "receipt_upload";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_RECEIPT_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export default function RegisterPage() {
  const [childFirstName, setChildFirstName] = useState("");
  const [childLastName, setChildLastName] = useState("");
  const [grade, setGrade] = useState<number>(1);
  const [dateOfBirth, setDateOfBirth] = useState("");

  const [parentFirstName, setParentFirstName] = useState("");
  const [parentLastName, setParentLastName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("transaction_id");
  const [transactionId, setTransactionId] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // Tracks the confirmed fileId after presign+upload+confirm
  const [confirmedReceiptFileId, setConfirmedReceiptFileId] = useState<string | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptUploadErr, setReceiptUploadErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── Step 1+2+3: presign → R2 PUT → confirm ──────────────────────────────
  async function uploadReceipt(file: File): Promise<string | null> {
    setReceiptUploading(true);
    setReceiptUploadErr(null);

    // Client-side validation first
    if (!ALLOWED_RECEIPT_MIME.includes(file.type)) {
      setReceiptUploadErr("Only JPEG, PNG, or WebP images are allowed.");
      setReceiptUploading(false);
      return null;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      setReceiptUploadErr("Receipt image must be under 5MB.");
      setReceiptUploading(false);
      return null;
    }

    try {
      // Step 1: Get presigned URL from server
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "receipt",
          mimeType: file.type,
          byteSize: file.size,
          originalName: file.name,
        }),
      });
      const presignData = await presignRes.json().catch(() => ({}));
      if (!presignRes.ok) {
        setReceiptUploadErr(presignData.error ?? "Failed to prepare upload.");
        setReceiptUploading(false);
        return null;
      }

      const { presignedUrl, fileId } = presignData as {
        presignedUrl: string;
        fileId: string;
      };

      // Step 2: Upload directly to R2
      const r2Res = await fetch(presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          "Content-Length": String(file.size),
        },
        body: file,
      });
      if (!r2Res.ok) {
        setReceiptUploadErr("Upload to storage failed. Please try again.");
        setReceiptUploading(false);
        return null;
      }

      // Step 3: Confirm with server (verifies R2 receipt + marks COMPLETED)
      const confirmRes = await fetch("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, context: "receipt" }),
      });
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) {
        setReceiptUploadErr(confirmData.error ?? "Upload confirmation failed.");
        setReceiptUploading(false);
        return null;
      }

      setReceiptUploading(false);
      return fileId;
    } catch {
      setReceiptUploadErr("Upload failed. Please check your connection and try again.");
      setReceiptUploading(false);
      return null;
    }
  }

  async function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setReceiptFile(file);
    setConfirmedReceiptFileId(null);
    setReceiptUploadErr(null);

    if (file) {
      const fileId = await uploadReceipt(file);
      if (fileId) setConfirmedReceiptFileId(fileId);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    setErr(null);

    if (paymentMethod === "transaction_id" && transactionId.trim().length === 0) {
      setLoading(false);
      setErr("Transaction ID is required.");
      return;
    }
    if (paymentMethod === "receipt_upload" && !confirmedReceiptFileId) {
      setLoading(false);
      setErr(
        receiptUploading
          ? "Receipt is still uploading. Please wait."
          : "Please upload a receipt image."
      );
      return;
    }

    const fd = new FormData();
    fd.append("childFirstName", childFirstName);
    fd.append("childLastName", childLastName);
    fd.append("grade", String(grade));
    fd.append("dateOfBirth", dateOfBirth);
    fd.append("parentFirstName", parentFirstName);
    fd.append("parentLastName", parentLastName);
    fd.append("parentEmail", parentEmail);
    fd.append("parentPhone", parentPhone);
    fd.append("paymentMethod", paymentMethod);

    if (paymentMethod === "transaction_id") {
      fd.append("transactionId", transactionId.trim());
    } else {
      fd.append("receiptFileId", confirmedReceiptFileId!);
    }

    const res = await fetch("/api/register", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setErr(data.error ?? "Registration failed");
      return;
    }

    setMsg("Registration submitted. Waiting for admin payment approval.");
    setChildFirstName("");
    setChildLastName("");
    setGrade(1);
    setDateOfBirth("");
    setParentFirstName("");
    setParentLastName("");
    setParentEmail("");
    setParentPhone("");
    setPaymentMethod("transaction_id");
    setTransactionId("");
    setReceiptFile(null);
    setConfirmedReceiptFileId(null);
  }

  return (
    <main className="min-h-screen p-10">
      <h1 className="text-3xl font-bold">Register</h1>

      <div className="mt-4 rounded border p-4">
        <p className="font-medium">Bank Details (Demo Placeholder)</p>
        <p className="mt-1 text-sm text-gray-700">
          Bank: Demo Bank • Account: 123456789 • Name: Literacy Platform
        </p>
        <p className="mt-1 text-sm text-gray-700">
          After payment, upload a receipt or provide your transaction ID below.
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 max-w-xl space-y-4">
        <section className="rounded border p-4">
          <h2 className="font-semibold">Child Info</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Child First Name</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={childFirstName}
                onChange={(e) => setChildFirstName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Child Last Name</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={childLastName}
                onChange={(e) => setChildLastName(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-sm font-medium">Grade (1–8)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              type="number"
              min={1}
              max={8}
              value={grade}
              onChange={(e) => setGrade(Number(e.target.value))}
              required
            />
          </div>
          <div className="mt-3">
            <label className="text-sm font-medium">Date of Birth</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              required
            />
          </div>
        </section>

        <section className="rounded border p-4">
          <h2 className="font-semibold">Parent Info</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Parent First Name</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={parentFirstName}
                onChange={(e) => setParentFirstName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Parent Last Name</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={parentLastName}
                onChange={(e) => setParentLastName(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-sm font-medium">Parent Email</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              required
            />
          </div>
          <div className="mt-3">
            <label className="text-sm font-medium">Parent Phone</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              required
            />
          </div>
        </section>

        <section className="rounded border p-4">
          <h2 className="font-semibold">Payment</h2>
          <div className="mt-3">
            <label className="text-sm font-medium">Payment Method</label>
            <select
              className="mt-1 w-full rounded border px-3 py-2"
              value={paymentMethod}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "transaction_id" || v === "receipt_upload")
                  setPaymentMethod(v);
              }}
            >
              <option value="transaction_id">Transaction ID</option>
              <option value="receipt_upload">Upload Receipt</option>
            </select>
          </div>

          {paymentMethod === "transaction_id" && (
            <div className="mt-3">
              <label className="text-sm font-medium">Transaction ID</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                required
              />
            </div>
          )}

          {paymentMethod === "receipt_upload" && (
            <div className="mt-3">
              <label className="text-sm font-medium">
                Upload Receipt (JPEG, PNG, WebP or PDF — max 5MB)
              </label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleReceiptChange}
                disabled={receiptUploading}
              />
              {receiptUploading && (
                <p className="mt-1 text-xs text-blue-600">
                  Uploading receipt...
                </p>
              )}
              {receiptUploadErr && (
                <p className="mt-1 text-xs text-red-600">{receiptUploadErr}</p>
              )}
              {confirmedReceiptFileId && !receiptUploading && (
                <p className="mt-1 text-xs text-green-700">
                  ✅ Receipt uploaded successfully.
                </p>
              )}
              <p className="mt-1 text-xs text-gray-600">
                After admin review, you will receive your login credentials by SMS.
              </p>
            </div>
          )}
        </section>

        {err && <p className="text-sm text-red-600">{err}</p>}
        {msg && <p className="text-sm text-green-700">{msg}</p>}

        <button
          disabled={loading || receiptUploading}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-60"
        >
          {loading ? "Submitting..." : "Submit Registration"}
        </button>
      </form>
    </main>
  );
}