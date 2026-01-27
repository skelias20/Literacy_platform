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
  const [detail, setDetail] = useState<null | { artifacts: Artifact[]; childName: string }>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
    const child = data.assessment.child;
    setDetail({
      childName: `${child.childFirstName} ${child.childLastName}`,
      artifacts: data.assessment.artifacts ?? [],
    });
  }

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
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
