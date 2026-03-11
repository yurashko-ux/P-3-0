// web/app/api/admin/binotel/call-record/route.ts
// Отримання тимчасового URL запису дзвінка через Binotel stats/call-record

import { NextRequest, NextResponse } from "next/server";
import { getCallRecordUrl } from "@/lib/binotel/call-record";

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

  const generalCallID = req.nextUrl.searchParams.get("generalCallID");
  if (!generalCallID?.trim()) {
    return NextResponse.json(
      { ok: false, error: "generalCallID обов'язковий" },
      { status: 400 }
    );
  }

  try {
    const result = await getCallRecordUrl(generalCallID.trim());

    if ("error" in result) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, url: result.url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[binotel/call-record] Помилка:", msg);
    return NextResponse.json(
      { ok: false, error: "Помилка отримання запису", details: msg },
      { status: 500 }
    );
  }
}
