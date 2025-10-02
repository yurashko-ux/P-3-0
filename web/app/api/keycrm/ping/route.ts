// web/app/api/keycrm/ping/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// будуємо Authorization так само, як у lib/keycrm.ts
function buildAuth(): string {
  const bearer = process.env.KEYCRM_BEARER?.trim();
  const token  = process.env.KEYCRM_API_TOKEN?.trim();
  if (bearer) return bearer;
  if (token) return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  return "";
}
function maskAuth(a?: string) {
  if (!a) return "(no auth)";
  if (a.toLowerCase().startsWith("bearer ")) {
    const t = a.slice(7);
    return "Authorization: Bearer " + (t.length <= 8 ? "***" : t.slice(0, 6) + "…***");
  }
  return "Authorization: " + (a.length <= 8 ? "***" : a.slice(0, 6) + "…***");
}

export async function GET() {
  const base = (process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
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
