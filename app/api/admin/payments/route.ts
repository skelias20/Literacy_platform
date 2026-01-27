import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET ?? "";
if (!SECRET) {
  throw new Error("JWT_SECRET is not set");
}



export async function GET(req: Request) {
  try {
    // ---- auth ----
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = jwt.verify(token, SECRET);


    if (typeof decoded !== "object" || decoded === null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = decoded as jwt.JwtPayload;
    const adminId = payload.adminId;
    const email = payload.email;

    if (typeof adminId !== "string" || typeof email !== "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ---- query ----
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status") ?? "pending";

    if (statusParam !== "pending" && statusParam !== "approved" && statusParam !== "rejected") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const payments = await prisma.payment.findMany({
      where: { status: statusParam },
      orderBy: { createdAt: "desc" },
      include: {
        child: {
          include: {
            parent: true,
          },
        },
        receiptFile: {
          select: {
            id: true,
            storageKey: true,
            originalName: true,
            mimeType: true,
            createdAt: true,
            // IMPORTANT: do NOT select byteSize (BigInt) or sha256 unless you need it
          },
        },
      },
    });
    

    return NextResponse.json({ payments });
  } catch (e: unknown) {
    // If jwt.verify throws, we treat as unauthorized
    if (e instanceof Error && e.name === "JsonWebTokenError") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
