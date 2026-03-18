import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import Link from "next/link";
export default function Home() {
  return (
    <main className="min-h-screen p-10 flex gap-3">
      <h1 className="text-3xl font-bold">Literacy Platform (Demo)</h1>
      <p className="mt-2 text-gray-600">
        App is running. Next: Admin login, registration, approval flow.
      </p>
      <Link className="underline" href="/register">
        Register
      </Link>
      <Link className="underline" href="/student/login">
        Login
      </Link>
      <Link className="underline" href="/admin/login">
        Admin
      </Link>
    </main>
  );
}
