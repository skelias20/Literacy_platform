export default function Home() {
  return (
    <main className="min-h-screen p-10">
      <h1 className="text-3xl font-bold">Literacy Platform (Demo)</h1>
      <p className="mt-2 text-gray-600">
        App is running. Next: Admin login, registration, approval flow.
      </p>

      <div className="mt-6 rounded border p-4">
        <p className="font-medium">Day 1 Checkpoint</p>
        <ul className="mt-2 list-disc pl-6 text-sm text-gray-700">
          <li>Next.js app boots</li>
          <li>Prisma migrated</li>
          <li>Admin seeded</li>
        </ul>
      </div>
    </main>
  );
}
