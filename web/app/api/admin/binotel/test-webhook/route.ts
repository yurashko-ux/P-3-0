// POST: симулює надходження вебхука від Binotel — для перевірки збереження в KV та пайплайну

import { NextRequest, NextResponse } from "next/server";

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

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Мок- payload як від Binotel (didNumber по цільовій лінії)
  const generalCallID = `test-webhook-${Date.now()}`;
  const mockPayload = {
    generalCallID,
    callID: generalCallID,
    externalNumber: "+380991234567",
    callType: "0", // вхідний
    disposition: "ANSWER",
    didNumber: BINOTEL_TARGET_LINE,
    startTime: Math.floor(Date.now() / 1000),
    billsec: 120,
    duration: 120,
  };

  // Завжди використовуємо production URL — на Vercel preview є Deployment Protection (401).
  // Binotel також шле вебхуки на production.
  const webhookUrl = "https://p-3-0.vercel.app/api/binotel/call-completed";

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mockPayload),
    });
    const data = await res.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      message: "Тестовий вебхук відправлено на /api/binotel/call-completed",
      webhookUrl,
      payload: mockPayload,
      responseStatus: res.status,
      responseBody: data,
      hint: "Натисніть «Останні вебхуки Binotel» — має зʼявитися нова подія.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
