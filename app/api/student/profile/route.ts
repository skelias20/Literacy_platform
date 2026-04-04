// app/api/student/profile/route.ts
// GET — returns the student's current editable profile fields
// Used by the student profile page to pre-populate the change request form.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentAuth } from "@/lib/serverAuth";

export async function GET() {
  try {
    const student = await requireStudentAuth();
    if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const child = await prisma.child.findUnique({
      where: { id: student.childId },
      select: {
        childFirstName: true,
        childLastName:  true,
        grade:          true,
        subjects:       true,
        parent: {
          select: {
            firstName: true,
            lastName:  true,
            email:     true,
            phone:     true,
          },
        },
      },
    });

    if (!child) return NextResponse.json({ error: "Not found." }, { status: 404 });

    return NextResponse.json({ profile: child });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
