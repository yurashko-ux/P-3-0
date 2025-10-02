// web/app/api/keycrm/ping/route.ts
import { NextResponse } from "next/server";
import { __KEYCRM_DEBUG } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskAuth(a?: string) {
  if (!a) return "(no auth header)";
  if (a.toLowerCase().startsWith("bearer ")) {
    const tail = a.slice(7);
    const masked = tail.length <= 8 ? "***" : tail.slice(0, 6) + "…***";
    return "Authorization: Bearer " + masked;
  }
  const masked = a.length <= 8 ? "***" : a.slice(0, 6) + "…***";
  return "Authorization: " + masked;
}

export async function GET() {
  const { BASE, AUTH, startsWithBearer } = __KEYCRM_DEBUG;
  const url = `${BASE}/pipelines?per_page=1`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(AUTH ? { Authorization: AUTH } : {}) },
      cache: "no-store",
    });
    const ct = res.headers.get("content-type") || "";
    const payload = ct.includes("application/json") ? await res.json().catch(() => null) : null;
    const snippet = !payload ? (await res.text().catch(() => "")).slice(0, 400) : undefined;
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      url,
      startsWithBearer,
      authHeaderPreview: maskAuth(AUTH),
      jsonKeys: payload ? Object.keys(payload) : [],
      snippet,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      url,
      startsWithBearer,
      authHeaderPreview: maskAuth(AUTH),
      error: String(e?.message || e),
    });
  }
}
