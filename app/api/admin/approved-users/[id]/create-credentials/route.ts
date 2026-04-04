import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/serverAuth";
import { sendCredentialsCreatedEmail } from "@/lib/email";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const adminId = await requireAdminAuth(req);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const child = await prisma.child.findUnique({
    where: { id },
    include: { parent: { select: { email: true } } },
  });
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
      credentialsCreatedById: adminId,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: "CREDENTIALS_CREATED",
      targetChildId: child.id,
      metadata: { username },
    },
  });

  void sendCredentialsCreatedEmail(
    child.parent?.email,
    `${child.childFirstName} ${child.childLastName}`,
    username,
    password
  ).catch(console.error);

  return NextResponse.json({ ok: true, child: updated });
}
