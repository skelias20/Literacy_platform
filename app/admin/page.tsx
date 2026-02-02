import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import Link from "next/link";

export default async function AdminHomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;

  if (!token) {
    return (
      <main className="p-10">
        <p>Not authenticated.</p>
      </main>
    );
  }

  const payload = verifyAdminJwt(token);

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Admin Dashboard</h1>
      <p className="mt-2 text-gray-700">Logged in as: {payload.email}</p>
      <div className="mt-4 flex gap-3">
  <Link className="underline" href="/admin/payments">
    Payments
  </Link>
  <Link className="underline" href="/admin/approved-users">
  Approved Users
</Link>
<Link className="underline" href="/admin/assessments">
  Assessments
</Link>
<Link className="underline" href="/admin/daily-tasks">
  Create Daily Tasks
</Link>

</div>
    </main>
  );
}
