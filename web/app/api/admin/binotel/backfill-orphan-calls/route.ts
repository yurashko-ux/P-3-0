// web/app/api/admin/binotel/backfill-orphan-calls/route.ts
// Backfill orphan Binotel calls (clientId = null): створюємо Binotel-ліди для номера без клієнта в Direct

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findOrCreateBinotelLead } from "@/lib/binotel/find-or-create-lead";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get("secret");
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orphans = await prisma.directClientBinotelCall.findMany({
      where: {
        clientId: null,
        externalNumber: { not: "" },
      },
      select: { id: true, generalCallID: true, externalNumber: true, startTime: true },
    });

    let processed = 0;
    let errors = 0;
    const details: { generalCallID: string; action: string }[] = [];

    for (const rec of orphans) {
      if (!rec.externalNumber?.trim()) continue;
      try {
        const clientId = await findOrCreateBinotelLead(rec.externalNumber, rec.startTime);
        await prisma.directClientBinotelCall.update({
          where: { id: rec.id },
          data: { clientId },
        });
        processed++;
        details.push({ generalCallID: rec.generalCallID, action: "linked" });
      } catch (e) {
        errors++;
        console.error("[binotel/backfill-orphan-calls] Помилка для", rec.generalCallID, e);
        details.push({ generalCallID: rec.generalCallID, action: "error" });
      }
    }

    return NextResponse.json({
      ok: true,
      orphansTotal: orphans.length,
      processed,
      errors,
      details,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      error: "Помилка backfill orphan Binotel calls",
      details: msg,
    }, { status: 500 });
  }
}
