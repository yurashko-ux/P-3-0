// web/app/api/admin/direct/clients/[id]/binotel-calls/route.ts
// Історія дзвінків Binotel по клієнту

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id: clientId } = await params;

  if (!clientId) {
    return NextResponse.json({ ok: false, error: "clientId required" }, { status: 400 });
  }

  /** Витягує URL запису з rawData (Binotel може повертати recordingUrl, audio_path, recordingLink тощо) */
  function extractRecordingUrl(raw: unknown): string | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const candidates = [
      r.recordingUrl,
      r.audio_path,
      r.recordingLink,
      r.recording,
      (r as any).recordingUrl?.url,
    ];
    for (const v of candidates) {
      if (typeof v === "string" && v.startsWith("http")) return v;
    }
    return null;
  }

  try {
    const calls = await prisma.directClientBinotelCall.findMany({
      where: { clientId },
      orderBy: { startTime: "desc" },
      take: 100,
    });

    return NextResponse.json({
      ok: true,
      calls: calls.map((c) => ({
        id: c.id,
        callType: c.callType,
        disposition: c.disposition,
        durationSec: c.durationSec,
        startTime: c.startTime.toISOString(),
        externalNumber: c.externalNumber,
        recordingUrl: extractRecordingUrl(c.rawData),
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      error: "Помилка отримання історії дзвінків",
      details: msg,
    });
  }
}
