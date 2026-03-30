"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
export default function StudentLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get("expired") === "1";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/student/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Login failed.");
      return;
    }

    router.replace("/student");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded border p-6">
        <h1 className="text-2xl font-bold">Student Login</h1>

        {sessionExpired && (
          <div className="mt-3 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            Your session has expired. Please sign in again.
          </div>
        )}

        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-sm font-medium">Username (Student ID)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Password</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            disabled={loading}
            className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <Link className="underline" href="/register">
 Register
</Link>
        </form>
      </div>
    </main>
  );
}