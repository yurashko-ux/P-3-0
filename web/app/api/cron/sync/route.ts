// web/app/api/cron/sync/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

function okCron(req: NextRequest) {
  // 1) Дозволяємо офіційний крон Vercel
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  if (isVercelCron) return true;

  // 2) Або запит з локальним секретом (на випадок ручного виклику)
  const urlSecret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  return false;
}

export async function POST(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const adminPass = process.env.ADMIN_PASS || "";
  const vercelUrl =
    process.env.VERCEL_URL ||
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host");

  if (!vercelUrl) {
    return NextResponse.json({ ok: false, error: "no vercel url" }, { status: 500 });
  }
  if (!adminPass) {
    return NextResponse.json({ ok: false, error: "missing ADMIN_PASS" }, { status: 500 });
  }

  const origin = `https://${vercelUrl}`;
  const syncUrl = `${origin}/api/keycrm/sync?per_page=50&max_pages=3`;

  try {
    const res = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${adminPass}`
      }
      // body: не потрібне — ваш /api/keycrm/sync приймає query-параметри
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      sync: data
    }, { status: res.ok ? 200 : res.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Дозволяємо GET для швидкої перевірки статусу (лише для крону/секрету)
  return POST(req);
}
