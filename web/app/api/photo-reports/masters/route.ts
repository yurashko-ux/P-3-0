// web/app/api/photo-reports/masters/route.ts
// API endpoint для отримання списку майстрів

import { NextResponse } from "next/server";
import { getMasters } from "@/lib/photo-reports/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const masters = getMasters();
    return NextResponse.json({ ok: true, masters });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

