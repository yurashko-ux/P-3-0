// web/app/api/_env/keycrm/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildAuth(): string {
  const bearer = process.env.KEYCRM_BEARER?.trim();
  const token  = process.env.KEYCRM_API_TOKEN?.trim();
  if (bearer) return bearer;
  if (token) return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  return "";
}
function mask(v?: string) {
  if (!v) return "(empty)";
  const s = String(v);
  if (s.toLowerCase().startsWith("bearer ")) {
    const t = s.slice(7);
    return "Bearer " + (t.length <= 8 ? "***" : t.slice(0, 4) + "…***");
  }
  return s.length <= 8 ? "***" : s.slice(0, 4) + "…***";
}

export async function GET() {
  const base = (process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
  const auth = buildAuth();
  return NextResponse.json({
    baseUrl: base,
    authPreview: mask(auth),
    startsWithBearer: !!auth && auth.toLowerCase().startsWith("bearer "),
    hasBearerEnv: !!process.env.KEYCRM_BEARER,
    hasTokenEnv: !!process.env.KEYCRM_API_TOKEN,
  });
}
