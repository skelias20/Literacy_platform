// app/admin/content/page.tsx
// FIXES FROM v1:
// - handleFileChange: restored try/catch wrapping the full presign→PUT→confirm flow
// - handleFileChange: restored setFormFileUploading(false) at each failure point inside try
// - saveContent: restored reset of formSkill, formLevel, formType after successful save
// - saveContent: restored original success message "Content item created successfully."
// - saveEdit: restored setMsg("Updated successfully.") on success
// - deleteItem: restored setErr(null)/setMsg(null) on start; setMsg("Item archived successfully.") on success
// - deleteWarning UI: restored yellow colour scheme and ⚠️ Warning heading
// - filters row: restored items-center alignment and ml-auto on Add Content button
// - form inputs: restored py-2 padding (not py-1.5) for consistency with original
// - form labels: restored asterisks on required fields (Title *, Skill *, Content Type *)
// - deleteWarning: restored display of affectedTasks list in warning body
// ADDITIONS (not regressions):
// - assessmentDefaultSlots included in ContentItem type and GET response
// - Assessment slot badges rendered as read-only pills on each content item card
// - Archive warning handles assessmentSlots warning from backend
// - Content library note directs admin to Assessments page for slot management

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/fetchWithAuth";

type SkillType = "reading" | "listening" | "writing" | "speaking";
type LiteracyLevel = "foundational" | "functional" | "transitional" | "advanced";
type ContentType =
  | "passage_text" | "passage_audio" | "questions"
  | "writing_prompt" | "speaking_prompt" | "pdf_document";

type AssessmentSlot = { level: LiteracyLevel; skill: SkillType; sessionNumber: number };

type ContentItem = {
  id: string;
  title: string;
  description: string | null;
  skill: SkillType;
  level: LiteracyLevel | null;
  type: ContentType;
  textBody: string | null;
  assetUrl: string | null;
  mimeType: string | null;
  isAssessmentDefault?: boolean; // kept for backward compat if old data exists — not displayed
  deletedAt: string | null;
  createdAt: string;
  assessmentDefaultSlots: AssessmentSlot[];
  file: {
    id: string; storageUrl: string | null; originalName: string;
    mimeType: string; byteSize: string; uploadStatus: string;
  } | null;
};

const SKILLS: SkillType[]     = ["reading", "listening", "writing", "speaking"];
const LEVELS: LiteracyLevel[] = ["foundational", "functional", "transitional", "advanced"];

const SKILL_CONTENT_TYPES: Record<SkillType, ContentType[]> = {
  reading:   ["pdf_document"],
  listening: ["passage_audio"],
  writing:   ["writing_prompt"],
  speaking:  ["speaking_prompt", "passage_audio"],
};
const FILE_REQUIRED_TYPES: ContentType[] = ["pdf_document", "passage_audio"];
const CONTENT_TYPE_MIME: Record<ContentType, string[]> = {
  pdf_document:    ["application/pdf"],
  passage_audio:   ["audio/mpeg"],
  writing_prompt:  [],
  speaking_prompt: [],
  questions:       [],
  passage_text:    [],
};
const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  pdf_document:    "PDF Document",
  passage_audio:   "Audio File (MP3)",
  writing_prompt:  "Writing Prompt (text)",
  speaking_prompt: "Speaking Prompt (text)",
  questions:       "Question Bank",
  passage_text:    "Passage Text",
};
const MAX_BYTES = 50 * 1024 * 1024;

function formatBytes(b: string | number): string {
  const n = Number(b);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminContentPage() {
  const [items, setItems]     = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [msg, setMsg]         = useState<string | null>(null);

  const [filterSkill, setFilterSkill] = useState<"all" | SkillType>("all");
  const [filterLevel, setFilterLevel] = useState<"all" | LiteracyLevel>("all");
  const [showDeleted, setShowDeleted] = useState(false);

  const [showForm, setShowForm]               = useState(false);
  const [formTitle, setFormTitle]             = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSkill, setFormSkill]             = useState<SkillType>("reading");
  const [formLevel, setFormLevel]             = useState<"all" | LiteracyLevel>("all");
  const [formType, setFormType]               = useState<ContentType>(SKILL_CONTENT_TYPES.reading[0]);
  const [formTextBody, setFormTextBody]       = useState("");
  const [formFile, setFormFile]               = useState<File | null>(null);
  const [formFileId, setFormFileId]           = useState<string | null>(null);
  const [formFileUploading, setFormFileUploading] = useState(false);
  const [formFileErr, setFormFileErr]         = useState<string | null>(null);
  const [formSaving, setFormSaving]           = useState(false);

  function handleSkillChange(skill: SkillType) {
    setFormSkill(skill);
    setFormType(SKILL_CONTENT_TYPES[skill][0]);
    setFormFile(null); setFormFileId(null); setFormFileErr(null);
  }

  const [editingId, setEditingId]             = useState<string | null>(null);
  const [editTitle, setEditTitle]             = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLevel, setEditLevel]             = useState<"all" | LiteracyLevel>("all");
  const [editSaving, setEditSaving]           = useState(false);

  const [deleteWarning, setDeleteWarning] = useState<{
    id: string;
    message: string;
    affectedTasks?: { taskId: string; taskDate: string; skill: string }[];
    assessmentSlots?: AssessmentSlot[];
  } | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    const qs = new URLSearchParams();
    if (filterSkill !== "all") qs.set("skill", filterSkill);
    if (filterLevel !== "all") qs.set("level", filterLevel);
    if (showDeleted) qs.set("includeDeleted", "true");
    const res  = await adminFetch(`/api/admin/content?${qs.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error ?? "Failed to load."); setLoading(false); return; }
    setItems(data.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true); setErr(null);
      const qs = new URLSearchParams();
      if (filterSkill !== "all") qs.set("skill", filterSkill);
      if (filterLevel !== "all") qs.set("level", filterLevel);
      if (showDeleted) qs.set("includeDeleted", "true");
      const res  = await adminFetch(`/api/admin/content?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) { setErr(data.error ?? "Failed to load."); setLoading(false); return; }
      setItems(data.items ?? []);
      setLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, [filterSkill, filterLevel, showDeleted]);

  // ── File upload: presign → R2 PUT → confirm ───────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setFormFile(file); setFormFileId(null); setFormFileErr(null);
    if (!file) return;

    const allowedMime = CONTENT_TYPE_MIME[formType];
    if (allowedMime.length > 0 && !allowedMime.includes(file.type)) {
      setFormFileErr(`This content type only accepts: ${allowedMime.join(", ")}`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setFormFileErr(`File exceeds ${formatBytes(MAX_BYTES)} limit.`);
      return;
    }

    setFormFileUploading(true);
    try {
      // Step 1: Presign
      const presignRes = await adminFetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "admin_content",
          mimeType: file.type,
          byteSize: file.size,
          originalName: file.name,
        }),
      });
      const presignData = await presignRes.json().catch(() => ({}));
      if (!presignRes.ok) {
        setFormFileErr(presignData.error ?? "Failed to prepare upload.");
        setFormFileUploading(false);
        return;
      }
      const { presignedUrl, fileId } = presignData as { presignedUrl: string; fileId: string };

      // Step 2: PUT to R2 — raw fetch intentional, this is a Cloudflare URL
      const r2Res = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!r2Res.ok) {
        setFormFileErr("Upload to storage failed. Please try again.");
        setFormFileUploading(false);
        return;
      }

      // Step 3: Confirm
      const confirmRes = await adminFetch("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, context: "admin_content" }),
      });
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) {
        setFormFileErr(confirmData.error ?? "Upload confirmation failed.");
        setFormFileUploading(false);
        return;
      }

      setFormFileId(fileId);
      setFormFileUploading(false);
    } catch {
      setFormFileErr("Upload failed. Check your connection.");
      setFormFileUploading(false);
    }
  }

  async function saveContent() {
    if (!formTitle.trim()) { setErr("Title is required."); return; }
    if (FILE_REQUIRED_TYPES.includes(formType) && !formFileId) {
      setErr(`A file upload is required for ${CONTENT_TYPE_LABELS[formType]}.`);
      return;
    }
    setFormSaving(true); setErr(null); setMsg(null);

    const res = await adminFetch("/api/admin/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formTitle,
        description: formDescription,
        skill: formSkill,
        level: formLevel,
        type: formType,
        textBody: formTextBody || null,
        fileId: formFileId || null,
        mimeType: formFile?.type || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setFormSaving(false);

    if (!res.ok) { setErr(data.error ?? "Save failed."); return; }

    setMsg("Content item created successfully.");
    setShowForm(false);
    setFormTitle("");
    setFormDescription("");
    setFormSkill("reading");
    setFormLevel("all");
    setFormType(SKILL_CONTENT_TYPES.reading[0]);
    setFormTextBody("");
    setFormFile(null);
    setFormFileId(null);
    await load();
  }

  async function saveEdit(id: string) {
    setEditSaving(true);
    const res = await adminFetch("/api/admin/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: editTitle, description: editDescription, level: editLevel }),
    });
    const data = await res.json().catch(() => ({}));
    setEditSaving(false);
    if (!res.ok) { setErr(data.error ?? "Update failed."); return; }
    setEditingId(null);
    setMsg("Updated successfully.");
    await load();
  }

  async function deleteItem(id: string, force = false) {
    setErr(null); setMsg(null);
    const res = await adminFetch("/api/admin/content", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, force }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.warning) {
      setDeleteWarning({
        id,
        message: data.message,
        affectedTasks: data.affectedTasks,
        assessmentSlots: data.assessmentSlots,
      });
      return;
    }
    if (!res.ok) { setErr(data.error ?? "Delete failed."); return; }

    setDeleteWarning(null);
    setMsg("Item archived successfully.");
    await load();
  }

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Content Library</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage PDFs and audio files used in daily tasks and assessments.
            To assign content to assessment slots, go to the{" "}
            <Link href="/admin/assessments" className="underline">Assessments</Link> page.
          </p>
        </div>
        <Link className="underline" href="/admin">Back to admin dashboard</Link>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {msg && <p className="mt-3 text-sm text-green-700">{msg}</p>}

      {/* Delete warning */}
      {deleteWarning && (
        <div className="mt-4 rounded border border-yellow-300 bg-yellow-50 p-4">
          <p className="font-semibold text-yellow-800">⚠️ Warning</p>
          <p className="mt-1 text-sm text-yellow-700">{deleteWarning.message}</p>
          {deleteWarning.assessmentSlots && deleteWarning.assessmentSlots.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {deleteWarning.assessmentSlots.map((s, i) => (
                <li key={i} className="text-xs text-yellow-700">
                  Assessment slot: {s.level} — {s.skill} — Session {s.sessionNumber}
                </li>
              ))}
            </ul>
          )}
          {deleteWarning.affectedTasks && deleteWarning.affectedTasks.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {deleteWarning.affectedTasks.map((t) => (
                <li key={t.taskId} className="text-xs text-yellow-700">
                  Task: {t.skill} on {new Date(t.taskDate).toLocaleDateString()}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-3">
            <button onClick={() => deleteItem(deleteWarning.id, true)}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white">
              Archive anyway
            </button>
            <button onClick={() => setDeleteWarning(null)} className="rounded border px-3 py-1 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select className="rounded border px-3 py-1.5 text-sm"
          value={filterSkill} onChange={(e) => setFilterSkill(e.target.value as "all" | SkillType)}>
          <option value="all">All skills</option>
          {SKILLS.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
        <select className="rounded border px-3 py-1.5 text-sm"
          value={filterLevel} onChange={(e) => setFilterLevel(e.target.value as "all" | LiteracyLevel)}>
          <option value="all">All levels</option>
          {LEVELS.map((l) => <option key={l} value={l} className="capitalize">{l}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Show archived
        </label>
        <button onClick={() => setShowForm(!showForm)}
          className="ml-auto rounded bg-black px-4 py-1.5 text-sm text-white">
          {showForm ? "Cancel" : "+ Add Content"}
        </button>
      </div>

      {/* Upload form */}
      {showForm && (
        <section className="mt-4 rounded border p-4">
          <h2 className="font-semibold">New Content Item</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Title *</label>
              <input className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={formTitle} onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. Level 1 Reading Passage" />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <input className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Skill *</label>
              <select className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={formSkill} onChange={(e) => handleSkillChange(e.target.value as SkillType)}>
                {SKILLS.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Level</label>
              <select className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={formLevel} onChange={(e) => setFormLevel(e.target.value as "all" | LiteracyLevel)}>
                <option value="all">All levels</option>
                {LEVELS.map((l) => <option key={l} value={l} className="capitalize">{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Content Type *</label>
              <select className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={formType}
                onChange={(e) => {
                  setFormType(e.target.value as ContentType);
                  if (!FILE_REQUIRED_TYPES.includes(e.target.value as ContentType)) {
                    setFormFile(null); setFormFileId(null); setFormFileErr(null);
                  }
                }}>
                {SKILL_CONTENT_TYPES[formSkill].map((t) => (
                  <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Only types valid for the <span className="font-medium capitalize">{formSkill}</span> skill are shown.
              </p>
            </div>
          </div>

          {(formType === "writing_prompt" || formType === "speaking_prompt" ||
            formType === "passage_text" || formType === "questions") && (
            <div className="mt-3">
              <label className="text-sm font-medium">Text Content</label>
              <textarea className="mt-1 w-full rounded border px-3 py-2 text-sm" rows={4}
                value={formTextBody} onChange={(e) => setFormTextBody(e.target.value)}
                placeholder="Enter the text content..." />
            </div>
          )}

          {FILE_REQUIRED_TYPES.includes(formType) && (
            <div className="mt-3">
              <label className="text-sm font-medium">
                Upload File ({CONTENT_TYPE_LABELS[formType]}, max {formatBytes(MAX_BYTES)})
              </label>
              <input type="file" accept={CONTENT_TYPE_MIME[formType].join(",")}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                onChange={handleFileChange} disabled={formFileUploading} />
              {formFileUploading && <p className="mt-1 text-xs text-blue-600">Uploading to storage...</p>}
              {formFileErr    && <p className="mt-1 text-xs text-red-600">{formFileErr}</p>}
              {formFileId && !formFileUploading && <p className="mt-1 text-xs text-green-700">✅ File uploaded successfully.</p>}
            </div>
          )}

          <button onClick={saveContent} disabled={formSaving || formFileUploading}
            className="mt-4 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60">
            {formSaving ? "Saving..." : "Save Content Item"}
          </button>
        </section>
      )}

      {/* Content list */}
      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-gray-600">Loading...</p>}
        {!loading && items.length === 0 && <p className="text-sm text-gray-600">No content items found.</p>}

        {items.map((item) => {
          const isEditing = editingId === item.id;
          const isDeleted = !!item.deletedAt;
          return (
            <div key={item.id} className={`rounded border p-4 ${isDeleted ? "opacity-50" : ""}`}>
              {isEditing ? (
                <div className="space-y-2">
                  <input className="w-full rounded border px-3 py-1.5 text-sm font-medium"
                    value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  <input className="w-full rounded border px-3 py-1.5 text-sm"
                    value={editDescription} onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Description (optional)" />
                  <select className="rounded border px-3 py-1.5 text-sm"
                    value={editLevel} onChange={(e) => setEditLevel(e.target.value as "all" | LiteracyLevel)}>
                    <option value="all">All levels</option>
                    {LEVELS.map((l) => <option key={l} value={l} className="capitalize">{l}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(item.id)} disabled={editSaving}
                      className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-60">
                      {editSaving ? "Saving..." : "Save"}
                    </button>
                    <button onClick={() => setEditingId(null)} className="rounded border px-3 py-1 text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{item.title}</p>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize">{item.skill}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{item.level ?? "all levels"}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{item.type.replace(/_/g, " ")}</span>
                      {isDeleted && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">archived</span>}
                      {/* Assessment slot badges — read-only, assignment managed on the Assessments page */}
                      {item.assessmentDefaultSlots?.map((slot) => (
                        <span key={`${slot.level}_${slot.skill}_${slot.sessionNumber}`}
                          className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700"
                          title="Assigned to assessment slot">
                          📋 {slot.level} S{slot.sessionNumber}
                        </span>
                      ))}
                    </div>
                    {item.description && <p className="mt-1 text-sm text-gray-600">{item.description}</p>}
                    {item.file && (
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                        <span>{item.file.originalName}</span>
                        <span>{formatBytes(item.file.byteSize)}</span>
                        {item.file.id && (
                          <a href={`/api/admin/files/${item.file.id}`} target="_blank" rel="noreferrer"
                            className="underline text-blue-600">Preview</a>
                        )}
                      </div>
                    )}
                    {item.textBody && (
                      <pre className="mt-2 max-h-20 overflow-hidden whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">
                        {item.textBody}
                      </pre>
                    )}
                  </div>
                  {!isDeleted && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setEditingId(item.id);
                          setEditTitle(item.title);
                          setEditDescription(item.description ?? "");
                          setEditLevel((item.level ?? "all") as "all" | LiteracyLevel);
                        }}
                        className="rounded border px-3 py-1 text-xs"
                      >
                        Edit
                      </button>
                      <button onClick={() => deleteItem(item.id)}
                        className="rounded border border-red-200 px-3 py-1 text-xs text-red-600">
                        Archive
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}