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

// збираємо можливі секрети (MC_TOKEN/ADMIN_PASS тощо)
function getSecretCandidates(): Array<{ name: string; value: string }> {
  const names = [
    "MC_TOKEN", "MANYCHAT_TOKEN",
    "MC_ADMIN_PASS", "INGEST_ADMIN_PASS",
    "ADMIN_PASS", "ADMIN_PASSWORD",
    "API_SECRET",
  ] as const;

  const res: Array<{ name: string; value: string }> = [];
  for (const n of names) {
    const v = String(process.env[n] ?? "").trim();
    if (v) res.push({ name: n, value: v });
  }
  return res;
}

function b64(u: string) {
  return Buffer.from(u, "utf8").toString("base64");
}

// формуємо набір хедерів для кожної СХЕМИ авторизації
function headerSets(secret: string, user: string) {
  const common: Record<string, string> = {
    "content-type": "application/json",
    "x-admin-pass": secret,
    "x-admin-pass-b64": b64(secret),
    "x-api-key": secret,
    "x-ingest-pass": secret,
    "x-mc-pass": secret,
    "x-token": secret,
  };

  return [
    { scheme: "bearer", headers: { ...common, authorization: `Bearer ${secret}` } },
    { scheme: "basic",  headers: { ...common, authorization: `Basic ${b64(`${user}:${secret}`)}` } },
  ] as const;
}

async function lookupLeadId(usernameRaw: string, req: NextRequest): Promise<number | null> {
  const username = (usernameRaw || "").trim().toLowerCase();
  if (!username) return null;
  const r = await fetch(`${baseUrl(req)}/api/kv/lookup?username=${encodeURIComponent(username)}`, { cache: "no-store" });
  if (!r.ok) return null;
  const data = (await r.json().catch(() => ({} as AnyObj))) as AnyObj;
  const id = Number(data?.payload?.card_id ?? data?.payload?.lead_id ?? data?.card_id);
  return Number.isFinite(id) ? id : null;
}

async function upsertKV(usernameRaw: string, lead_id: number, req: NextRequest): Promise<void> {
  // upsert для кешу username→lead_id; використовує будь-який доступний секрет
  const candidates = getSecretCandidates();
  if (!candidates.length) return;
  try {
    await fetch(`${baseUrl(req)}/api/kv/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-pass-b64": b64(candidates[0].value) },
      body: JSON.stringify({ username: String(usernameRaw || "").trim().toLowerCase(), card_id: lead_id }),
    });
  } catch {}
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
    try { body = await req.json(); } catch { body = {}; }

    const uname = String(body?.instagram_username ?? body?.username ?? "").trim().toLowerCase() || "";
    let lead_id: number | null = Number.isFinite(Number(body?.lead_id)) ? Number(body.lead_id) : null;

    if (!lead_id && uname) lead_id = await lookupLeadId(uname, req);
    if (!lead_id) {
      return NextResponse.json(
        { ok: false, error: "Provide lead_id (number) OR instagram_username (resolves via /api/kv/lookup)" },
        { status: 400, headers: withCORS() }
      );
    }

    if (uname) upsertKV(uname, lead_id, req).catch(() => {});

    const candidates = getSecretCandidates();
    if (!candidates.length) {
      return NextResponse.json(
        { ok: false, error: "No admin secret set (MC_TOKEN / ADMIN_PASS / ...)" },
        { status: 500, headers: withCORS() }
      );
    }

    const adminUser = String(process.env.ADMIN_USER ?? "admin");
    const upstreamUrl = `${baseUrl(req)}/api/mc/ingest`;
    const attempts: Array<{ name: string; scheme: string; status: number }> = [];

    for (const cand of candidates) {
      for (const set of headerSets(cand.value, adminUser)) {
        const upstream = await fetch(upstreamUrl, {
          method: "POST",
          headers: set.headers,
          body: JSON.stringify({ ...body, lead_id }),
        });

        const ct = upstream.headers.get("content-type") || "";
        const payload = ct.includes("application/json")
          ? await upstream.json().catch(() => ({}))
          : await upstream.text();

        attempts.push({ name: cand.name, scheme: set.scheme, status: upstream.status });

        if (upstream.ok) {
          return NextResponse.json(
            { ok: true, status: upstream.status, source: cand.name, schemeTried: set.scheme, upstream: payload },
            { status: upstream.status, headers: withCORS() }
          );
        }
        if (![401, 403].includes(upstream.status)) {
          return NextResponse.json(
            { ok: false, status: upstream.status, sourceTried: cand.name, schemeTried: set.scheme, upstream: payload },
            { status: upstream.status, headers: withCORS() }
          );
        }
      }
    }

    return NextResponse.json(
      { ok: false, status: 401, error: "All auth attempts failed", attempts },
      { status: 401, headers: withCORS() }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500, headers: withCORS() });
  }
}
