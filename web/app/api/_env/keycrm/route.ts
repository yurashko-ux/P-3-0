// web/app/api/_env/keycrm/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mask(v?: string) {
  if (!v) return "";
  const s = String(v);
  return s.length <= 12 ? "***" : s.slice(0, 8) + "…***";
}

export async function GET() {
  const url = (process.env.KEYCRM_API_URL || "").replace(/\/+$/, "");
  const bearer = process.env.KEYCRM_BEARER;
  const token = process.env.KEYCRM_API_TOKEN;

  return NextResponse.json({
    baseUrl: url || "(empty)",
    hasBearer: !!bearer,
    hasToken: !!token,
    // тільки прев’ю — без розкриття повного значення
    bearerPreview: mask(bearer),
    tokenPreview: mask(token),
    willUseHeader: bearer ? "Authorization: Bearer <from KEYCRM_BEARER>" :
      token ? "Authorization: Bearer <from KEYCRM_API_TOKEN>" : "(none)",
  });
}
