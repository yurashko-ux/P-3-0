// web/app/api/keycrm/ping/route.ts
import { NextResponse } from "next/server";
import { baseUrl, buildAuth, maskAuth } from "../_common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = baseUrl();
  const auth = buildAuth();
  const url  = `${base}/pipelines?per_page=1`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(auth ? { Authorization: auth } : {}) },
      cache: "no-store",
    });
    const ct = res.headers.get("content-type") || "";
    const json = ct.includes("application/json") ? await res.json().catch(() => null) : null;
    const snippet = json ? undefined : (await res.text().catch(() => "")).slice(0, 400);

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      url,
      startsWithBearer: !!auth && auth.toLowerCase().startsWith("bearer "),
      authHeaderPreview: maskAuth(auth),
      jsonKeys: json ? Object.keys(json) : [],
      snippet,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      url,
      startsWithBearer: !!auth && auth.toLowerCase().startsWith("bearer "),
      authHeaderPreview: maskAuth(auth),
      error: String(e?.message || e),
    });
  }
}
