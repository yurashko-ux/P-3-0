// web/app/api/keycrm/diag/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Заглушка: діагностичний роут вимкнено, щоб не ламати білд
export async function GET() {
  return NextResponse.json(
    { ok: false, error: "diag route disabled" },
    { status: 410 }
  );
}
export async function POST() {
  return GET();
}
