// web/app/api/admin/binotel/cleanup-wrong-line-calls/route.ts
// Видалення дзвінків не по цільовій лінії (0930007800) та orphan Binotel-лідів.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/binotel/normalize-phone";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const BINOTEL_TARGET_LINE = process.env.BINOTEL_TARGET_LINE?.trim() || "0930007800";

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

/** Перевіряє, чи дзвінок по цільовій лінії. rawData — повний payload Binotel. */
function isCallOnTargetLine(rawData: unknown): boolean {
  const raw = rawData as Record<string, unknown> | null;
  const pbx = raw?.pbxNumberData as Record<string, unknown> | null | undefined;
  const didNumber = (raw?.didNumber ?? pbx?.number ?? "").toString().trim();
  if (!didNumber) return false;
  return normalizePhone(didNumber) === normalizePhone(BINOTEL_TARGET_LINE);
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const allCalls = await prisma.directClientBinotelCall.findMany({
      select: { id: true, clientId: true, generalCallID: true, rawData: true },
    });

    const toDelete = allCalls.filter((c) => !isCallOnTargetLine(c.rawData));
    const affectedClientIds = new Set<string>();
    for (const c of toDelete) {
      if (c.clientId) affectedClientIds.add(c.clientId);
    }

    // Видаляємо дзвінки не по цільовій лінії
    let deletedCalls = 0;
    for (const rec of toDelete) {
      await prisma.directClientBinotelCall.delete({
        where: { id: rec.id },
      });
      deletedCalls++;
    }

    // Видаляємо orphan Binotel-ліди (state=binotel-lead, binotel_*, 0 дзвінків)
    let deletedClients = 0;
    for (const clientId of affectedClientIds) {
      const client = await prisma.directClient.findUnique({
        where: { id: clientId },
        select: { id: true, state: true, instagramUsername: true, _count: { select: { binotelCalls: true } } },
      });
      if (!client) continue;
      if (client.state !== "binotel-lead") continue;
      if (!client.instagramUsername?.startsWith("binotel_")) continue;
      // Після видалення дзвінків залишилось 0
      if (client._count.binotelCalls > 0) continue;

      await prisma.directClient.delete({ where: { id: clientId } });
      deletedClients++;
    }

    return NextResponse.json({
      ok: true,
      targetLine: BINOTEL_TARGET_LINE,
      callsTotal: allCalls.length,
      callsDeleted: deletedCalls,
      clientsDeleted: deletedClients,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[binotel/cleanup-wrong-line-calls] Помилка:", msg);
    return NextResponse.json({
      ok: false,
      error: "Помилка cleanup",
      details: msg,
    }, { status: 500 });
  }
}
