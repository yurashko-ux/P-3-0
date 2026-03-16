// web/app/api/bank/monobank/webhook/log/route.ts
// GET: останні події вебхука Monobank з KV (діагностика)

import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { kvRead } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KV_KEY = "bank:monobank:webhook:log";
const MAX_ITEMS = 50;

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const raw = await kvRead.lrange(KV_KEY, 0, MAX_ITEMS - 1);
    const events = raw.map((s) => {
      try {
        return JSON.parse(s) as { receivedAt?: string; type?: string; account?: string; statementId?: string };
      } catch {
        return { raw: s };
      }
    });
    return NextResponse.json({
      ok: true,
      count: events.length,
      events,
      hint: "Якщо count=0, вебхук від Monobank ще не надходив або URL не зареєстровано.",
    });
  } catch (err) {
    console.error("[bank/monobank/webhook/log] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка читання логу" },
      { status: 500 }
    );
  }
}
