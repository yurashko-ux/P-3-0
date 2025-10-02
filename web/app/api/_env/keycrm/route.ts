// web/app/api/_env/keycrm/route.ts
import { NextResponse } from "next/server";
import { __KEYCRM_DEBUG } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mask(v?: string) {
  if (!v) return "";
  const s = String(v);
  // збережемо префікс "Bearer " якщо він є
  if (s.toLowerCase().startsWith("bearer ")) {
    const tail = s.slice(7);
    const masked = tail.length <= 8 ? "***" : tail.slice(0, 4) + "…***";
    return "Bearer " + masked;
  }
  return s.length <= 8 ? "***" : s.slice(0, 4) + "…***";
}

export async function GET() {
  const dbg = __KEYCRM_DEBUG;
  return NextResponse.json({
    baseUrl: dbg.BASE,
    authPreview: mask(dbg.AUTH),
    startsWithBearer: dbg.startsWithBearer,
  });
}
