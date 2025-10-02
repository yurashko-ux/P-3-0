// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from "next/server";
import { fetchPipelines } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchPipelines(); // safe: повертає [] при збої
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("GET /api/keycrm/pipelines failed:", e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
