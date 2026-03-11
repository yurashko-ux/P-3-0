// web/app/api/admin/binotel/raw-call-from-db/route.ts
// Діагностика: повертає rawData одного дзвінка з БД для перевірки структури (recording URL тощо)

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const call = await prisma.directClientBinotelCall.findFirst({
      orderBy: { startTime: "desc" },
      select: { id: true, generalCallID: true, externalNumber: true, startTime: true, rawData: true },
    });

    if (!call) {
      return NextResponse.json({
        ok: true,
        message: "Немає дзвінків у БД",
        call: null,
      });
    }

    const raw = call.rawData as Record<string, unknown> | null;
    const allKeys = raw ? Object.keys(raw) : [];
    const recordingRelatedKeys = allKeys.filter(
      (k) =>
        /record|audio|url|link|path|file|media/i.test(k)
    );

    return NextResponse.json({
      ok: true,
      call: {
        id: call.id,
        generalCallID: call.generalCallID,
        externalNumber: call.externalNumber,
        startTime: call.startTime,
      },
      rawData: raw,
      allKeys,
      recordingRelatedKeys,
      recordingRelatedValues: recordingRelatedKeys.reduce(
        (acc, k) => ({ ...acc, [k]: raw?.[k] }),
        {} as Record<string, unknown>
      ),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      error: "Помилка",
      details: msg,
    });
  }
}
