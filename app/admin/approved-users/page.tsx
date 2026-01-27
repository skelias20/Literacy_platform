"use client";

import { useEffect, useState } from "react";

type ChildRow = {
  id: string;
  childFirstName: string;
  childLastName: string;
  grade: number;
  parent: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
};

export default function ApprovedUsersPage() {
  const [rows, setRows] = useState<ChildRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<
    Record<string, { username: string; password: string }>
  >({});

  async function load() {
    setLoading(true);
    setMsg(null);
    const res = await fetch("/api/admin/approved-users");
    const data = await res.json();
    setRows(data.children ?? []);
    setLoading(false);
  }

  useEffect(() => {
    let alive = true;
  
    (async () => {
      setLoading(true);
      setMsg(null);
  
      const res = await fetch("/api/admin/approved-users");
      const data = await res.json();
  
      if (!alive) return;
  
      setRows(data.children ?? []);
      setLoading(false);
    })();
  
    return () => {
      alive = false;
    };
  }, []);
  

  async function createCredentials(id: string) {
    const entry = form[id];
    if (!entry?.username || !entry?.password) {
      setMsg("Username and password required.");
      return;
    }

    const res = await fetch(
      `/api/admin/approved-users/${id}/create-credentials`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      }
    );

    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? "Failed to create credentials.");
      return;
    }

    setMsg("Credentials created.");
    setForm((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    load();
  }

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Approved Users</h1>

      {msg && <p className="mt-3 text-sm">{msg}</p>}

      <div className="mt-6 space-y-4">
        {rows.length === 0 && (
          <p className="text-sm text-gray-600">No users awaiting credentials.</p>
        )}

        {rows.map((c) => (
          <div key={c.id} className="rounded border p-4">
            <p className="font-medium">
              {c.childFirstName} {c.childLastName} (Grade {c.grade})
            </p>
            <p className="text-sm text-gray-700">
              Parent: {c.parent.firstName} {c.parent.lastName} —{" "}
              {c.parent.email}
            </p>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                className="rounded border px-3 py-2 text-sm"
                placeholder="Username (Student ID)"
                value={form[c.id]?.username ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    [c.id]: {
                      ...prev[c.id],
                      username: e.target.value,
                      password: prev[c.id]?.password ?? "",
                    },
                  }))
                }
              />
              <input
                className="rounded border px-3 py-2 text-sm"
                type="password"
                placeholder="Password"
                value={form[c.id]?.password ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    [c.id]: {
                      ...prev[c.id],
                      password: e.target.value,
                      username: prev[c.id]?.username ?? "",
                    },
                  }))
                }
              />
              <button
                className="rounded bg-black px-3 py-2 text-white"
                onClick={() => createCredentials(c.id)}
              >
                Create Credentials
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
