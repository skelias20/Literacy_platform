// app/api/admin/billing-config/route.ts
// GET  /api/admin/billing-config  — read current BillingConfig (or defaults if none)
// PUT  /api/admin/billing-config  — upsert BillingConfig (admin only)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifyAdminJwt } from "@/lib/auth";
import { parseBody } from "@/lib/parseBody";
import { z } from "zod";

export const runtime = "nodejs";

const BillingConfigSchema = z.object({
  cycleDays:         z.number().int().min(1).max(365),
  gracePeriodDays:   z.number().int().min(0).max(30),
  renewalWindowDays: z.number().int().min(0).max(30),
  monthlyFee:        z.number().min(0).max(9999.99).nullable().optional(),
  currency:          z.string().min(1).max(10).trim().optional().default("USD"),
});

async function requireAdmin(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  try { return verifyAdminJwt(token).adminId; }
  catch { return null; }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try { verifyAdminJwt(token); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

    const config = await prisma.billingConfig.findFirst();

    if (!config) {
      // Return defaults when no config row exists yet.
      return NextResponse.json({
        config: {
          cycleDays: 30,
          gracePeriodDays: 7,
          renewalWindowDays: 7,
          monthlyFee: null,
          currency: "USD",
        },
        exists: false,
      });
    }

    return NextResponse.json({
      config: {
        cycleDays:         config.cycleDays,
        gracePeriodDays:   config.gracePeriodDays,
        renewalWindowDays: config.renewalWindowDays,
        // Decimal → string to avoid BigInt/Decimal serialization issues.
        monthlyFee:        config.monthlyFee !== null ? config.monthlyFee.toString() : null,
        currency:          config.currency,
      },
      exists: true,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(BillingConfigSchema, await req.json().catch(() => null), "billing-config");
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const existing = await prisma.billingConfig.findFirst();

    if (existing) {
      await prisma.billingConfig.update({
        where: { id: existing.id },
        data: {
          cycleDays:         body.cycleDays,
          gracePeriodDays:   body.gracePeriodDays,
          renewalWindowDays: body.renewalWindowDays,
          monthlyFee:        body.monthlyFee ?? null,
          currency:          body.currency ?? "USD",
          updatedByAdminId:  adminId,
        },
      });
    } else {
      await prisma.billingConfig.create({
        data: {
          cycleDays:         body.cycleDays,
          gracePeriodDays:   body.gracePeriodDays,
          renewalWindowDays: body.renewalWindowDays,
          monthlyFee:        body.monthlyFee ?? null,
          currency:          body.currency ?? "USD",
          updatedByAdminId:  adminId,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
