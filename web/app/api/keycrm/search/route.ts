// web/app/api/keycrm/search/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Тимчасово вимкнено, щоб не ламати білд (не використовується у створенні/списку кампаній)
export async function GET() {
  return NextResponse.json({ ok: false, error: "search disabled" }, { status: 410 });
}
export async function POST() {
  return GET();
}
