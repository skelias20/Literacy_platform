// app/api/student/unknown-words/route.ts
// GET  — paginated list of words for the authenticated student
// POST — upsert (add or update) a word for the authenticated student

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { AddUnknownWordSchema } from "@/lib/schemas";

export const runtime = "nodejs";

async function requireStudent() {
  const cookieStore = await cookies();
  const token = cookieStore.get("student_token")?.value;
  if (!token) return null;
  try {
    return verifyStudentJwt(token);
  } catch {
    return null;
  }
}

// GET /api/student/unknown-words?limit=20&offset=0
// Returns { words: [...], total: number }
export async function GET(req: Request) {
  try {
    const student = await requireStudent();
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url    = new URL(req.url);
    const limit  = Math.min(Math.max(Number(url.searchParams.get("limit")  ?? "20"), 1), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

    const [words, total] = await prisma.$transaction([
      prisma.unknownWord.findMany({
        where:   { childId: student.childId },
        orderBy: { createdAt: "desc" },
        take:    limit,
        skip:    offset,
        select:  { id: true, word: true, source: true, note: true, createdAt: true },
      }),
      prisma.unknownWord.count({ where: { childId: student.childId } }),
    ]);

    return NextResponse.json({ words, total });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/student/unknown-words
// Body: { word, source, note? }
// Upserts on (childId, word) — no error if word already exists.
// Returns { word: {...}, created: boolean }
export async function POST(req: Request) {
  try {
    const student = await requireStudent();
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(
      AddUnknownWordSchema,
      await req.json().catch(() => null),
      "unknown-words POST"
    );
    if (!parsed.ok) return parsed.response;
    const { word, source, note } = parsed.data;

    // Check existence first so we can report whether this was a new row.
    const existing = await prisma.unknownWord.findUnique({
      where:  { childId_word: { childId: student.childId, word } },
      select: { id: true },
    });

    const savedWord = await prisma.unknownWord.upsert({
      where:  { childId_word: { childId: student.childId, word } },
      update: { source, note },
      create: { childId: student.childId, word, source, note },
      select: { id: true, word: true, source: true, note: true, createdAt: true },
    });

    return NextResponse.json(
      { word: savedWord, created: existing === null },
      { status: 201 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
