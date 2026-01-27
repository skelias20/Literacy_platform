import Link from "next/link";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function StudentHomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;

  if (!token) {
    return (
      <main className="p-10">
        <p>
          Not authenticated. <Link className="underline" href="/student/login">Go to login</Link>
        </p>
      </main>
    );
  }

  const payload = verifyStudentJwt(token);

  const child = await prisma.child.findUnique({
    where: { id: payload.childId },
    include: { parent: true },
  });

  if (!child) {
    return (
      <main className="p-10">
        <p>Account not found.</p>
      </main>
    );
  }

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Student Dashboard</h1>

      <div className="mt-4 rounded border p-4">
        <p className="font-medium">
          {child.childFirstName} {child.childLastName} (Grade {child.grade})
        </p>
        <p className="text-sm text-gray-700">Username: {child.username}</p>
        <p className="text-sm text-gray-700">Status: {child.status}</p>
        <p className="text-sm text-gray-700">
          Level: {child.level ?? "Not assigned yet"}
        </p>
      </div>

      {child.status === "assessment_required" && (
  <div className="mt-6 rounded border p-4">
    <p className="font-medium">Initial Assessment Required</p>
    <p className="mt-1 text-sm text-gray-700">
      Complete the initial assessment so the admin can assign your level.
    </p>
    <Link
      className="mt-3 inline-block rounded bg-black px-4 py-2 text-white"
      href="/student/assessment"
    >
      Start Initial Assessment
    </Link>
  </div>
)}
      
      {child.status === "pending_level_review" && (
  <div className="mt-6 rounded border p-4">
    <p className="font-medium">Admin is assessing your level</p>
    <p className="mt-1 text-sm text-gray-700">
      You already submitted your initial assessment. Please wait for the admin to assign your level.
      If you log out and log back in, you will still see this page until your level is assigned.
    </p>
  </div>
)}


{child.status === "active" && (
  <div className="mt-6 rounded border p-4">
    <p className="font-medium">Daily Tasks (coming soon)</p>
    <p className="mt-1 text-sm text-gray-700">
      Daily tasks will appear here.
    </p>
  </div>
)}

    </main>
  );
}
