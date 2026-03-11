// web/app/api/admin/binotel/fetch-calls-sample/route.ts
// Отримання зразка дзвінків за останні 24 год для діагностики структури даних

import { NextRequest, NextResponse } from "next/server";
import { fetchIncomingAndOutgoingForPeriod } from "@/lib/binotel/fetch-calls";
import type { BinotelCallRecord } from "@/lib/binotel/fetch-calls";

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

/** Нормалізує номер для порівняння — лишає тільки цифри, починаючи з 38 або 0 */
function normalizeForCompare(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("38") && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith("0") && digits.length >= 9) return "38" + digits;
  return digits;
}

/** Перевіряє, чи дзвінок пов'язаний з цільовою лінією (0930007800).
 * Якщо Binotel не повертає didNumber/pbxNumberData — приймаємо всі (потрібно перевірити raw). */
function isCallOnTargetLine(call: BinotelCallRecord): boolean {
  const targetNorm = normalizeForCompare(BINOTEL_TARGET_LINE);
  const didNumber = (call.didNumber ?? (call as any).pbxNumberData?.number ?? "").toString().trim();
  if (didNumber) {
    return normalizeForCompare(didNumber) === targetNorm;
  }
  // Поле для фільтрації відсутнє — поки включаємо всі вхідні
  return true;
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 24 * 60 * 60; // останні 24 години

  try {
    const { incoming, outgoing } = await fetchIncomingAndOutgoingForPeriod(dayAgo, now);

    // Відфільтрувати по лінії (якщо є didNumber)
    const incomingFiltered = incoming.filter(isCallOnTargetLine);
    const outgoingFiltered = outgoing; // вихідні — зазвичай з нашої лінії, фільтр за потреби

    // Перший запис як зразок структури для документування
    const sampleIncoming = incoming[0];
    const sampleOutgoing = outgoing[0];

    return NextResponse.json({
      ok: true,
      targetLine: BINOTEL_TARGET_LINE,
      period: { start: new Date(dayAgo * 1000).toISOString(), end: new Date(now * 1000).toISOString() },
      counts: {
        incomingTotal: incoming.length,
        incomingFiltered: incomingFiltered.length,
        outgoingTotal: outgoing.length,
        outgoingFiltered: outgoingFiltered.length,
      },
      sampleIncoming: sampleIncoming
        ? {
            generalCallID: sampleIncoming.generalCallID,
            externalNumber: sampleIncoming.externalNumber,
            internalNumber: sampleIncoming.internalNumber,
            disposition: sampleIncoming.disposition,
            callType: sampleIncoming.callType,
            startTime: sampleIncoming.startTime,
            didNumber: sampleIncoming.didNumber,
            pbxNumberData: sampleIncoming.pbxNumberData,
            allKeys: Object.keys(sampleIncoming),
            rawFull: sampleIncoming,
          }
        : null,
      sampleOutgoing: sampleOutgoing
        ? {
            generalCallID: sampleOutgoing.generalCallID,
            externalNumber: sampleOutgoing.externalNumber,
            internalNumber: sampleOutgoing.internalNumber,
            disposition: sampleOutgoing.disposition,
            callType: sampleOutgoing.callType,
            startTime: sampleOutgoing.startTime,
            historyData: sampleOutgoing.historyData,
            allKeys: Object.keys(sampleOutgoing),
            rawFull: sampleOutgoing,
          }
        : null,
      incomingFiltered: incomingFiltered.slice(0, 10),
      outgoingFiltered: outgoingFiltered.slice(0, 10),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      error: "Помилка запиту до Binotel",
      details: msg,
    });
  }
}
