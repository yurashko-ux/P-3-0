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
  h.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-pass, x-admin-pass-b64, x-api-key, x-ingest-pass, x-mc-pass, x-token"
  );
  return h;
}

// ▶️ Пріоритет: MC_TOKEN для ManyChat ingest
function getAdminSecret(): { secret: string | null; source: string | null } {
  const candidates = [
    "MC_TOKEN", // головний секрет для /api/mc/ingest
    "MC_ADMIN_PASS",
    "INGEST_ADMIN_PASS",
    "ADMIN_PASS",
    "ADMIN_PASSWORD",
    "API_SECRET",
    "MANYCHAT_TOKEN",
  ] as const;
  for (const name of candidates) {
    const v = String(process.env[name] ?? "").trim();
    if (v) return { secret: v, source: name };
  }
  return { secret: null, source: null };
}

async function lookupLeadId(usernameRaw: string, req: NextRequest): Promise<number | null> {
  const username = (usernameRaw || "").trim().toLowerCase();
  if (!username) return null;
  const r = await fetch(`${baseUrl(req)}/api/kv/lookup?username=${encodeURIComponent(username)}`, {
    cache: "no-store",
  });
  if (!r.ok) return null;
  const data = (await r.json().catch(() => ({} as AnyObj))) as AnyObj;
  const id = Number(data?.payload?.card_id ?? data?.payload?.lead_id ?? data?.card_id);
  return Number.isFinite(id) ? id : null;
}

async function upsertKV(usernameRaw: string, lead_id: number, req: NextRequest): Promise<void> {
  const { secret } = getAdminSecret();
  if (!secret) return; // не блокуємо, просто пропускаємо
  const b64 = Buffer.from(secret, "utf8").toString("base64");
  const body = { username: String(usernameRaw || "").trim().toLowerCase(), card_id: lead_id };
  try {
    await fetch(`${baseUrl(req)}/api/kv/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-pass-b64": b64 },
      body: JSON.stringify(body),
    });
  } catch {}
}

function adminHeaders(): { headers?: Record<string, string>; err?: string } {
  const { secret, source } = getAdminSecret();
  if (!secret) return { err: "Server is missing admin secret (MC_TOKEN/…)" };
  const b64 = Buffer.from(secret, "utf8").toString("base64");
  return {
    headers: {
      "content-type": "application/json",
      // надсилаємо одразу всі поширені варіанти
      "x-admin-pass": secret,
      "x-admin-pass-b64": b64,
      authorization: `Bearer ${secret}`,
      "x-api-key": secret,
      "x-ingest-pass": secret,
      "x-mc-pass": secret,
      "x-token": secret,
      "x-secret-source": source ?? "",
    },
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCORS() });
}

export async function GET() {
  return NextResponse.json(
    { ok: true, allow: ["GET", "POST", "OPTIONS"], route: "/api/mc/ingest-proxy" },
    { headers: withCORS() }
  );
}

export async function POST(req: NextRequest) {
  try {
    let body: AnyObj = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const uname = String(body?.instagram_username ?? body?.username ?? "").trim().toLowerCase() || "";
    let lead_id: number | null = Number.isFinite(Number(body?.lead_id)) ? Number(body.lead_id) : null;

    if (!lead_id && uname) {
      lead_id = await lookupLeadId(uname, req);
    }
    if (!lead_id) {
      return NextResponse.json(
        { ok: false, error: "Provide lead_id (number) OR instagram_username (resolves via /api/kv/lookup)" },
        { status: 400, headers: withCORS() }
      );
    }

    if (uname) {
      upsertKV(uname, lead_id, req).catch(() => {});
    }

    const ah = adminHeaders();
    if (ah.err || !ah.headers) {
      return NextResponse.json({ ok: false, error: ah.err ?? "No admin headers" }, { status: 500, headers: withCORS() });
    }

    const upstream = await fetch(`${baseUrl(req)}/api/mc/ingest`, {
      method: "POST",
      headers: ah.headers,
      body: JSON.stringify({ ...body, lead_id }),
    });

    const ct = upstream.headers.get("content-type") || "";
    const payload = ct.includes("application/json")
      ? await upstream.json().catch(() => ({}))
      : await upstream.text();

    return NextResponse.json({ ok: upstream.ok, status: upstream.status, upstream: payload }, { status: upstream.status, headers: withCORS() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500, headers: withCORS() });
  }
}
