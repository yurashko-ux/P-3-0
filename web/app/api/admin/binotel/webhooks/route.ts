// web/app/api/admin/binotel/webhooks/route.ts
// GET останніх вебхуків Binotel з KV (для діагностики)

import { NextRequest, NextResponse } from "next/server";
import { kvRead } from "@/lib/kv";
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

function isCallOnTargetLine(call: Record<string, unknown>): boolean {
  const didNumber = (call.didNumber ?? (call as any).pbxNumberData?.number ?? "").toString().trim();
  if (didNumber) {
    return normalizePhone(didNumber) === normalizePhone(BINOTEL_TARGET_LINE);
  }
  return false;
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100) : 20;

    const rawItems = await kvRead.lrange("binotel:webhook:log", 0, limit - 1);
    const events = rawItems
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed === "object" &&
            "value" in parsed &&
            typeof parsed.value === "string"
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return { raw };
        }
      })
      .filter(Boolean);

    const lastWebhooks = events.map((e: any) => {
      const body = e.body || e;
      const skipped = !isCallOnTargetLine(body);
      return {
        receivedAt: e.receivedAt,
        generalCallID: body.generalCallID ?? body.callID ?? null,
        externalNumber: body.externalNumber ?? null,
        callType: body.callType === "0" || body.callType === 0 ? "incoming" : "outgoing",
        disposition: body.disposition ?? null,
        skipped,
        body,
      };
    });

    return NextResponse.json({
      ok: true,
      eventsCount: events.length,
      lastWebhooks,
      allEvents: events.slice(0, 5),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: "Не вдалося прочитати лог вебхуків",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
