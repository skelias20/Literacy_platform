// app/admin/LogoutButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="rounded border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60"
    >
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}
