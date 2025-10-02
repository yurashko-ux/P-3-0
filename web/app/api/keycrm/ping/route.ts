// web/app/api/keycrm/ping/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = (process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
const AUTH =
  process.env.KEYCRM_BEARER ??
  (process.env.KEYCRM_API_TOKEN ? `Bearer ${process.env.KEYCRM_API_TOKEN}` : "");

function mask(v?: string) {
  if (!v) return "";
  const s = String(v);
  return s.length <= 12 ? "***" : s.slice(0, 8) + "…***";
}

export async function GET() {
  const url = `${BASE}/pipelines?per_page=1`;
  let status = 0;
  let text = "";
  let json: any = null;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(AUTH ? { Authorization: AUTH } : {}),
      },
      cache: "no-store",
    });
    status = res.status;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) json = await res.json().catch(() => null);
    else text = (await res.text()).slice(0, 500);
    return NextResponse.json({
      ok: res.ok,
      status,
      url,
      authHeaderPreview: AUTH ? `Authorization: ${mask(AUTH)}` : "(no auth header)",
      jsonKeys: json ? Object.keys(json) : [],
      snippet: text || undefined,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      status,
      url,
      authHeaderPreview: AUTH ? `Authorization: ${mask(AUTH)}` : "(no auth header)",
      error: String(e?.message || e),
    });
  }
}
