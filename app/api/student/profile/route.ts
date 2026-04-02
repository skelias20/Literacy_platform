// app/api/student/profile/route.ts
// GET — returns the student's current editable profile fields
// Used by the student profile page to pre-populate the change request form.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyStudentJwt } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("student_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let childId: string;
    try {
      childId = verifyStudentJwt(token).childId;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const child = await prisma.child.findUnique({
      where: { id: childId },
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
