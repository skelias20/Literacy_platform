import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await req.json();

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 }
    );
  }

  const child = await prisma.child.findUnique({ where: { id } });
  if (!child) {
    return NextResponse.json({ error: "Child not found." }, { status: 404 });
  }

  if (child.status !== "approved_pending_login") {
    return NextResponse.json(
      { error: "Child is not awaiting credentials." },
      { status: 400 }
    );
  }

  const existing = await prisma.child.findUnique({
    where: { username },
  });

  if (existing) {
    return NextResponse.json(
      { error: "Username already exists." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const updated = await prisma.child.update({
    where: { id },
    data: {
      username,
      passwordHash,
      status: "assessment_required",
      credentialsCreatedAt: new Date(),
      credentialsCreatedById: (
        await prisma.admin.findFirst({ select: { id: true } })
      )!.id,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: (
        await prisma.admin.findFirst({ select: { id: true } })
      )!.id,
      action: "CREDENTIALS_CREATED",
      targetChildId: child.id,
      metadata: { username },
    },
  });

  return NextResponse.json({ ok: true, child: updated });
}
