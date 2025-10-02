// web/app/api/_echo/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  let parsed: any = null;
  let raw = "";

  try {
    if (ct.includes("application/json")) {
      parsed = await req.json();
    } else if (
      ct.includes("multipart/form-data") ||
      ct.includes("application/x-www-form-urlencoded")
    ) {
      const fd = await req.formData();
      const obj: Record<string, string> = {};
      // Використовуємо forEach — він є у всіх реалізаціях FormData
      fd.forEach((v, k) => {
        obj[k] = typeof v === "string" ? v : String(v);
      });
      parsed = obj;
    } else {
      raw = await req.text(); // fallback
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message, contentType: ct },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    method: req.method,
    contentType: ct,
    parsed,
    rawLength: raw.length,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST something here to inspect payload" });
}
