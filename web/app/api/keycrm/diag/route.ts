// web/app/api/keycrm/diag/route.ts
import { NextRequest, NextResponse } from "next/server";
import { diagPipelines, diagStatuses } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/keycrm/diag       -> перевіряє всі варіанти pipelines
// GET /api/keycrm/diag?pid=X -> перевіряє всі варіанти statuses для pipeline X
export async function GET(req: NextRequest) {
  const pid = req.nextUrl.searchParams.get("pid") || "";
  const res = pid ? await diagStatuses(pid) : await diagPipelines();
  return NextResponse.json({ ok: true, base: process.env.KEYCRM_API_URL, trace: res.trace });
}
