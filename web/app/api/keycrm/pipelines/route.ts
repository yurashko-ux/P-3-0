// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from "next/server";
import { fetchPipelines } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await fetchPipelines(); // strictly uses provided ENV
  return NextResponse.json({ ok: true, data });
}
