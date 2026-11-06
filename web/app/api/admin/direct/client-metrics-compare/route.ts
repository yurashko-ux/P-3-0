// Звірка метрик клієнтів: Kresco (база + журнал) проти контрольних значень Altegio.

import { NextRequest, NextResponse } from "next/server";
import { isDirectAdminAuthorizedAsync } from "@/lib/direct-admin-auth";
import { compareClientMetrics } from "@/lib/direct-client-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(req: NextRequest) {
  if (!(await isDirectAdminAuthorizedAsync(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await compareClientMetrics()) });
}
