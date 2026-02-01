"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  submittedAt: string;
  child: {
    id: string;
    childFirstName: string;
    childLastName: string;
    grade: number;
    status: string;
    parent: { email: string; phone: string; firstName: string; lastName: string };
  };
};

type Artifact = {
  id: string;
  skill: string;
  textBody: string | null;
  fileId: string | null;
  createdAt: string;
};

export default function AdminAssessmentsPage() {
  const [list, setList] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Updated state to include level and status info
const [detail, setDetail] = useState<null | { 
  artifacts: Artifact[]; 
  childName: string;
  assignedLevel?: string | null; // Needed for assignedLabel
  child?: { status: string; level?: string | null }; // Needed for isAssigned
}>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [level, setLevel] = useState<"foundational" | "functional" | "transitional" | "advanced">("foundational");


  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/assessments");
      const data = await res.json();
      if (!alive) return;
      setList(data.assessments ?? []);
    })();
    return () => { alive = false; };
  }, []);

  async function loadDetail(id: string) {
    setSelectedId(id);
    setMsg(null);
    const res = await fetch(`/api/admin/assessments/${id}`);
    const data = await res.json();
    
    if (!res.ok) {
      setMsg(data.error ?? "Failed to load");
      return;
    }
  
    const assessment = data.assessment;
    const child = assessment.child;
  
    setDetail({
      childName: `${child.childFirstName} ${child.childLastName}`,
      artifacts: assessment.artifacts ?? [],
      assignedLevel: assessment.assignedLevel, // Save this
      child: child, // Save this
    });
  
    // Automatically set the dropdown to the already assigned level if it exists
    const assigned = assessment.assignedLevel ?? child.level ?? null;
    if (assigned) {
      setLevel(assigned);
    }
  }
  async function assignLevel() {
    if (!selectedId) return;
    setMsg(null);
  
    const res = await fetch("/api/admin/assessments/assign-level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentId: selectedId, level }),
    });
  
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data as { error?: string }).error;
      setMsg(err ?? "Failed to assign level");
      return;
    }
  
    setMsg("Level assigned. Student is now active.");
  
    // OPTIONAL: refresh list so you can see it disappear if your list endpoint filters
    const res2 = await fetch("/api/admin/assessments");
    const data2 = await res2.json();
    setList(data2.assessments ?? []);
  }
  
  const isAssigned =
  !!detail?.assignedLevel || detail?.child?.status === "active" || !!detail?.child?.level;

const assignedLabel =
  detail?.assignedLevel ?? detail?.child?.level ?? null;


  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Submitted Initial Assessments</h1>
      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded border p-4">
          <h2 className="font-semibold">Submissions</h2>
          <div className="mt-3 space-y-2">
            {list.length === 0 && (
              <p className="text-sm text-gray-600">No submissions yet.</p>
            )}
            {list.map((a) => (
              <button
                key={a.id}
                className={`w-full rounded border px-3 py-2 text-left text-sm ${
                  selectedId === a.id ? "bg-gray-50" : ""
                }`}
                onClick={() => loadDetail(a.id)}
              >
                <div className="font-medium">
                  {a.child.childFirstName} {a.child.childLastName} (G{a.child.grade})
                </div>
                <div className="text-xs text-gray-600">
                  Submitted: {new Date(a.submittedAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded border p-4">
          <h2 className="font-semibold">Details</h2>

          {!detail && (
            <p className="mt-3 text-sm text-gray-600">
              Select an assessment to view artifacts.
            </p>
          )}

          {detail && (
            <div className="mt-3 space-y-3">
              <p className="text-sm">
                <span className="font-medium">Student:</span> {detail.childName}
              </p>
              
              {detail.artifacts.length === 0 && (
                <p className="text-sm text-gray-600">No artifacts.</p>
              )}

              {detail.artifacts.map((x) => (
                <div key={x.id} className="rounded border p-3">
                  <p className="text-sm font-medium">Skill: {x.skill}</p>
                  {x.textBody ? (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">
                      {x.textBody}
                    </pre>
                  ) : (
                    <p className="mt-2 text-xs text-gray-600">
                      { x.fileId ? (
  <a
    className="mt-2 inline-block underline text-xs"
    href={`/api/admin/files/${x.fileId}`}
  >
    Download file
  </a>
) : (
  <p className="mt-2 text-xs text-gray-600">(No file)</p>
)}

                    </p>
                  )}
                </div>
              ))}


<div className="rounded border p-3">
  <p className="text-sm font-medium">Assign Level</p>
  <div className="mt-2 flex flex-wrap items-center gap-2">
  {isAssigned && assignedLabel && (
  <p className="text-sm text-green-700">
    Student has already been assigned to level: <span className="font-medium">{assignedLabel}</span>
  </p>
)}

  <select
  className="rounded border px-2 py-1 text-sm disabled:opacity-60"
  value={level}
  disabled={isAssigned}
  onChange={(e) =>
    setLevel(e.target.value as "foundational" | "functional" | "transitional" | "advanced")
  }
>

      <option value="foundational">foundational</option>
      <option value="functional">functional</option>
      <option value="transitional">transitional</option>
      <option value="advanced">advanced</option>
    </select>

    <button
  className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-60"
  onClick={assignLevel}
  disabled={isAssigned}
>
  {isAssigned ? "Already assigned" : "Save"}
</button>

  </div>
</div>



            </div>
          )}
        </div>
      </div>
    </main>
  );
}
