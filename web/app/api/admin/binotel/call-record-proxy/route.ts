// web/app/api/admin/binotel/call-record-proxy/route.ts
// Проксі для стримінгу запису дзвінка — обхід CORS та проблем з підписаними URL

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
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const generalCallID = req.nextUrl.searchParams.get("generalCallID");
  if (!generalCallID?.trim()) {
    return new NextResponse("generalCallID обов'язковий", { status: 400 });
  }

  try {
    const result = await getCallRecordUrl(generalCallID.trim());

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    // Сервер завантажує MP3 з S3 (без CORS), потім стримить клієнту
    const audioRes = await fetch(result.url, {
      cache: "no-store",
      headers: { "User-Agent": "P-3-0-BinotelProxy/1.0" },
    });
    if (!audioRes.ok) {
      const bodyPreview = (await audioRes.text()).slice(0, 200);
      console.warn(
        "[call-record-proxy] S3 відповідь:",
        audioRes.status,
        generalCallID,
        result.url.substring(0, 80),
        "body:",
        bodyPreview
      );
      return new NextResponse("Запис недоступний", { status: 502 });
    }

    const blob = await audioRes.blob();
    const contentType = audioRes.headers.get("content-type") || "audio/mpeg";

    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300", // 5 хв
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[binotel/call-record-proxy] Помилка:", msg);
    return new NextResponse("Помилка отримання запису", { status: 500 });
  }
}
