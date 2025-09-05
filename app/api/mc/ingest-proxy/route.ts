// app/api/mc/ingest-proxy/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnyObj = { [k: string]: any };

function baseUrl(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

function withCORS(init?: ResponseInit) {
  const h = new Headers(init?.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-pass, x-admin-pass-b64");
  return h;
}

async function lookupLeadId(usernameRaw: string, req: NextRequest): Promise<number | null> {
  const username = (usernameRaw || "").trim().toLowerCase();
  if (!username) return null;
  const r = await fetch(`${baseUrl(req)}/api/kv/lookup?username=${encodeURIComponent(username)}`, { cache: "no-store" });
  if (!r.ok) return null;
  const data = await r.json().catch(() => ({} as AnyObj));
  const id = Number(data?.payload?.card_id ?? data?.payload?.lead_id ?? data?.card_id);
  return Number.isFinite(id) ? id : null;
}

async function upsertKV(usernameRaw: string, lead_id: number, req: NextRequest): Promise<void> {
  const admin = String(process.env.ADMIN_PASS ?? process.env.ADMIN_PASSWORD ?? "");
  if (!admin) return; // тихо пропускаємо, якщо немає пароля
  const b64 = Buffer.from(admin, "utf8").toString("base64");

  const body = { username: String(usernameRaw || "").trim().toLowerCase(), card_id: lead_id };
  try {
    await fetch(`${baseUrl(req)}/api/kv/lookup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-pass-b64": b64,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // не блокуємо основний потік через помилку кешування
  }
}

function adminHeaders(): { headers: Record<string,string>, err?: string } {
  const admin = String(process.env.ADMIN_PASS ?? process.env.ADMIN_PASSWORD ?? "");
  if (!admin) return { headers: {}, err: "Server is missing ADMIN_PASS/ADMIN_PASSWORD env" };
  const b64 = Buffer.from(admin, "utf8").toString("base64");
  // Підставляємо відразу кілька поширених варіантів — що б там не перевіряв /api/mc/ingest
  return {
    headers: {
      "content-type": "application/json",
      "x-admin-pass": admin,
      "x-admin-pass-b64": b64,
      "authorization": `Bearer ${admin}`,
      "x-api-key": admin,
      "x-admin": admin,
      "x-token": admin,
    }
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCORS() });
}

export async function GET() {
  return NextResponse.json({ ok: true, allow: ["GET","POST","OPTIONS"], route: "/api/mc/ingest-proxy" }, { headers: withCORS() });
}

export async function POST(req: NextRequest) {
  try {
    let body: AnyObj = {};
    try { body = await req.json(); } catch { body = {}; }

    const uname = String(body?.instagram_username ?? body?.username ?? "").trim().toLowerCase() || "";
    let lead_id: number | null = Number.isFinite(Number(body?.lead_id)) ? Number(body.lead_id) : null;

    // 1) Якщо немає lead_id — пробуємо знайти через KV
    if (!lead_id && uname) {
      lead_id = await lookupLeadId(uname, req);
    }

    if (!lead_id) {
      return NextResponse.json(
        { ok:false, error:"Provide lead_id (number) OR instagram_username (resolves via /api/kv/lookup)" },
        { status:400, headers: withCORS() }
      );
    }

    // 2) Якщо маємо username — синхронно/асинхронно закинемо мапу в KV (не блокує потік)
    if (uname) {
      upsertKV(uname, lead_id, req).catch(()=>{});
    }

    // 3) Підготовка заголовків із серверного ENV
    const ah = adminHeaders();
    if (ah.err) {
      return NextResponse.json({ ok:false, error: ah.err }, { status:500, headers: withCORS() });
    }

    // 4) Проксі у твій існуючий /api/mc/ingest
    const upstream = await fetch(`${baseUrl(req)}/api/mc/ingest`, {
      method: "POST",
      headers: ah.headers,
      body: JSON.stringify({ ...body, lead_id })
    });

    const ct = upstream.headers.get("content-type") || "";
    const payload = ct.includes("application/json") ? await upstream.json().catch(()=> ({})) : await upstream.text();

    return NextResponse.json(
      { ok: upstream.ok, status: upstream.status, upstream: payload },
      { status: upstream.status, headers: withCORS() }
    );
  } catch (err:any) {
    return NextResponse.json({ ok:false, error: err?.message ?? "Unknown error" }, { status:500, headers: withCORS() });
  }
}
