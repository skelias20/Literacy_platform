// app/api/dictionary/route.ts
// GET /api/dictionary?word=<word>
//
// Shared endpoint — accepts either a valid student_token or admin_token cookie.
// No separate admin route needed; dictionary data is non-sensitive.
//
// Input: word query param — lowercase + trim enforced here; only [a-z\-\'] chars
// are valid in WordNet. Anything else returns 404 immediately (no DB round-trip).
//
// Returns: { word, pronunciation, partOfSpeech, definition, extraDefs }
// 404 if word not in dictionary.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAdminToken, verifyStudentToken } from "@/lib/serverAuth";

export const runtime = "nodejs";

const WORD_RE = /^[a-z'-]+$/;

export async function GET(req: Request) {
  // ── Auth: accept either student or admin token ────────────────────────────
  const cookieStore = await cookies();
  const adminToken   = cookieStore.get("admin_token")?.value;
  const studentToken = cookieStore.get("student_token")?.value;

  const isAdmin   = adminToken   ? await verifyAdminToken(adminToken)   : null;
  const isStudent = studentToken ? await verifyStudentToken(studentToken) : null;

  if (!isAdmin && !isStudent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const url    = new URL(req.url);
  const rawWord = url.searchParams.get("word") ?? "";
  const word   = rawWord.trim().toLowerCase();

  if (!word) {
    return NextResponse.json({ error: "word query param is required" }, { status: 400 });
  }
  if (word.length > 100) {
    return NextResponse.json({ error: "word too long" }, { status: 400 });
  }
  if (!WORD_RE.test(word)) {
    // Characters outside [a-z'-] cannot exist in the dictionary — skip DB entirely.
    return NextResponse.json({ error: "Word not found in dictionary" }, { status: 404 });
  }

  // ── Lookup ────────────────────────────────────────────────────────────────
  try {
    const entry = await prisma.dictionaryEntry.findUnique({
      where:  { word },
      select: { word: true, pronunciation: true, partOfSpeech: true, definition: true, extraDefs: true },
    });

    if (!entry) {
      return NextResponse.json({ error: "Word not found in dictionary" }, { status: 404 });
    }

    return NextResponse.json(entry);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
