"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Profile = {
  childFirstName: string;
  childLastName: string;
  grade: number;
  subjects: string[];
  parent: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
};

type ChangeRequest = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedChanges: Record<string, unknown>;
  snapshotBefore: Record<string, unknown>;
  requestedAt: string;
  reviewedAt: string | null;
  adminNote: string | null;
};

const SUBJECT_OPTIONS = [
  "English", "Math", "Science", "History", "Geography",
  "Art", "Music", "Physical Education", "Technology", "Other",
];

function StatusBadge({ status }: { status: ChangeRequest["status"] }) {
  if (status === "PENDING")
    return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Pending review</span>;
  if (status === "APPROVED")
    return <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">Approved</span>;
  return <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800">Rejected</span>;
}

const FIELD_LABELS: Record<string, string> = {
  childFirstName:  "First name",
  childLastName:   "Last name",
  grade:           "Grade",
  subjects:        "Favourite subjects",
  parentFirstName: "Parent first name",
  parentLastName:  "Parent last name",
  parentEmail:     "Parent email",
  parentPhone:     "Parent phone",
};

export default function StudentProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lastRequest, setLastRequest] = useState<ChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [childFirstName, setChildFirstName] = useState("");
  const [childLastName, setChildLastName]   = useState("");
  const [grade, setGrade]                   = useState("");
  const [subjects, setSubjects]             = useState<string[]>([]);
  const [parentFirstName, setParentFirstName] = useState("");
  const [parentLastName, setParentLastName]   = useState("");
  const [parentEmail, setParentEmail]         = useState("");
  const [parentPhone, setParentPhone]         = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const [profileRes, reqRes] = await Promise.all([
          fetch("/api/student/profile"),
          fetch("/api/student/profile/change-request"),
        ]);
        if (cancelled) return;

        if (!profileRes.ok) { setError("Failed to load profile."); setLoading(false); return; }

        const { profile: p } = await profileRes.json();
        const { request }    = await reqRes.json();

        if (!cancelled) {
          setProfile(p);
          setLastRequest(request ?? null);
          // Pre-fill form with current values
          setChildFirstName(p.childFirstName);
          setChildLastName(p.childLastName);
          setGrade(String(p.grade));
          setSubjects(p.subjects ?? []);
          setParentFirstName(p.parent.firstName);
          setParentLastName(p.parent.lastName);
          setParentEmail(p.parent.email);
          setParentPhone(p.parent.phone);
          setLoading(false);
        }
      } catch {
        if (!cancelled) { setError("Failed to load profile."); setLoading(false); }
      }
    }
    run();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    setSubmitError(null);

    // Only send fields that actually changed
    const changes: Record<string, unknown> = {};
    if (childFirstName.trim() !== profile.childFirstName)   changes.childFirstName  = childFirstName.trim();
    if (childLastName.trim()  !== profile.childLastName)    changes.childLastName   = childLastName.trim();
    const gradeNum = parseInt(grade, 10);
    if (!isNaN(gradeNum) && gradeNum !== profile.grade)     changes.grade           = gradeNum;
    if (JSON.stringify(subjects) !== JSON.stringify(profile.subjects)) changes.subjects = subjects;
    if (parentFirstName.trim() !== profile.parent.firstName) changes.parentFirstName = parentFirstName.trim();
    if (parentLastName.trim()  !== profile.parent.lastName)  changes.parentLastName  = parentLastName.trim();
    if (parentEmail.trim()     !== profile.parent.email)     changes.parentEmail     = parentEmail.trim();
    if (parentPhone.trim()     !== profile.parent.phone)     changes.parentPhone     = parentPhone.trim();

    if (Object.keys(changes).length === 0) {
      setSubmitError("No changes detected. Update at least one field before submitting.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/student/profile/change-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to submit request.");
      } else {
        setSubmitSuccess(true);
        // Refresh the request status
        const reqRes = await fetch("/api/student/profile/change-request");
        const { request } = await reqRes.json();
        setLastRequest(request ?? null);
      }
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleSubject(s: string) {
    setSubjects((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  const hasPendingRequest = lastRequest?.status === "PENDING";

  if (loading) return <main className="p-10"><p className="text-gray-600">Loading…</p></main>;
  if (error)   return <main className="p-10"><p className="text-red-600">{error}</p></main>;

  return (
    <main className="p-10 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/student" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">My Profile</h1>
      </div>

      {/* Current profile summary */}
      {profile && (
        <div className="rounded border p-4 mb-6 bg-gray-50">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Current Profile</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-500">Name</span>
            <span>{profile.childFirstName} {profile.childLastName}</span>
            <span className="text-gray-500">Grade</span>
            <span>{profile.grade}</span>
            <span className="text-gray-500">Favourite subjects</span>
            <span>{profile.subjects.length > 0 ? profile.subjects.join(", ") : "—"}</span>
            <span className="text-gray-500">Parent name</span>
            <span>{profile.parent.firstName} {profile.parent.lastName}</span>
            <span className="text-gray-500">Parent email</span>
            <span>{profile.parent.email}</span>
            <span className="text-gray-500">Parent phone</span>
            <span>{profile.parent.phone}</span>
          </div>
        </div>
      )}

      {/* Last request status */}
      {lastRequest && (
        <div className={`rounded border p-4 mb-6 ${
          lastRequest.status === "PENDING"  ? "border-amber-300 bg-amber-50"  :
          lastRequest.status === "APPROVED" ? "border-green-300 bg-green-50"  :
          "border-red-300 bg-red-50"
        }`}>
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-sm">
              {lastRequest.status === "PENDING"  ? "Your change request is awaiting admin review." :
               lastRequest.status === "APPROVED" ? "Your last change request was approved." :
               "Your last change request was rejected."}
            </p>
            <StatusBadge status={lastRequest.status} />
          </div>

          {/* Requested changes */}
          <div className="mt-2 text-sm space-y-1">
            {Object.entries(lastRequest.requestedChanges).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-gray-500 w-40 shrink-0">{FIELD_LABELS[k] ?? k}</span>
                <span className="font-medium">
                  {Array.isArray(v) ? v.join(", ") : String(v)}
                </span>
              </div>
            ))}
          </div>

          {lastRequest.adminNote && (
            <p className="mt-3 text-sm text-red-700 font-medium">
              Admin note: {lastRequest.adminNote}
            </p>
          )}

          <p className="mt-2 text-xs text-gray-400">
            Submitted {new Date(lastRequest.requestedAt).toLocaleDateString()}
            {lastRequest.reviewedAt && ` · Reviewed ${new Date(lastRequest.reviewedAt).toLocaleDateString()}`}
          </p>
        </div>
      )}

      {/* Blocked message while pending */}
      {hasPendingRequest && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          You have a pending change request. You cannot submit another until admin reviews it.
        </div>
      )}

      {/* Change request form */}
      {!hasPendingRequest && !submitSuccess && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <p className="text-sm text-gray-600">
            To update your profile information, edit the fields below and submit a request.
            An admin will review and apply the changes.
          </p>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700">Student info</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">First name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={childFirstName}
                  onChange={(e) => setChildFirstName(e.target.value)}
                  maxLength={64}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Last name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={childLastName}
                  onChange={(e) => setChildLastName(e.target.value)}
                  maxLength={64}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Grade (1–12)</label>
              <input
                type="number"
                min={1}
                max={12}
                className="w-24 rounded border px-3 py-2 text-sm"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Favourite subjects</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {SUBJECT_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSubject(s)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      subjects.includes(s)
                        ? "bg-black text-white border-black"
                        : "bg-white text-gray-700 border-gray-300 hover:border-gray-500"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700">Parent / guardian info</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">First name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={parentFirstName}
                  onChange={(e) => setParentFirstName(e.target.value)}
                  maxLength={64}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Last name</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={parentLastName}
                  onChange={(e) => setParentLastName(e.target.value)}
                  maxLength={64}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input
                type="email"
                className="w-full rounded border px-3 py-2 text-sm"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                maxLength={254}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <input
                type="tel"
                className="w-full rounded border px-3 py-2 text-sm"
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                maxLength={20}
              />
            </div>
          </fieldset>

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-black px-5 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit change request"}
          </button>
        </form>
      )}

      {submitSuccess && (
        <div className="rounded border border-green-300 bg-green-50 p-4 text-sm text-green-800 mt-4">
          Your change request has been submitted. An admin will review it shortly.
        </div>
      )}
    </main>
  );
}
