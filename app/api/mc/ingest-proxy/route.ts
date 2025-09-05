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

/** Повертає всі наявні секрети (в порядку пріоритету) */
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

function buildHeaders(secret: string): Record<string, string> {
  const b64 = Buffer.from(secret, "utf8").toString("base64");
  return {
    "content-type": "application/json",
    "x-admin-pass": secret,
    "x-admin-pass-b64": b64,
    authorization: `Bearer ${secret}`,
    "x-api-key": secret,
    "x-ingest-pass": secret,
    "x-mc-pass": secret,
    "x-token": secret,
  };
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
  // upsert для кешу username→lead_id; використовує перший доступний секрет (будь-який)
  const candidates = getSecretCandidates();
  if (!candidates.length) return;
  const b64 = Buffer.from(candidates[0].value, "utf8").toString("base64");
  const body = { username: String(usernameRaw || "").trim().toLowerCase(), card_id: lead_id };
  try {
    await fetch(`${baseUrl(req)}/api/kv/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-pass-b64": b64 },
      body: JSON.stringify(body),
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
        { ok: false, error: "No admin secret set (MC_TOKEN / MANYCHAT_TOKEN / ADMIN_PASS / ...)" },
        { status: 500, headers: withCORS() }
      );
    }

    const upstreamUrl = `${baseUrl(req)}/api/mc/ingest`;
    const attempts: Array<{ name: string; status: number }> = [];

    for (const cand of candidates) {
      const hdrs = buildHeaders(cand.value);
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ ...body, lead_id }),
      });

      const ct = upstream.headers.get("content-type") || "";
      const payload = ct.includes("application/json")
        ? await upstream.json().catch(() => ({}))
        : await upstream.text();

      attempts.push({ name: cand.name, status: upstream.status });

      if (upstream.ok) {
        return NextResponse.json(
          { ok: true, status: upstream.status, source: cand.name, upstream: payload },
          { status: upstream.status, headers: withCORS() }
        );
      }
      if (![401, 403].includes(upstream.status)) {
        // інші помилки не пов’язані з авторизацією — повертаємо відразу
        return NextResponse.json(
          { ok: false, status: upstream.status, sourceTried: cand.name, upstream: payload },
          { status: upstream.status, headers: withCORS() }
        );
      }
      // 401/403 → пробуємо наступний секрет
    }

    // всі спроби дали 401/403
    return NextResponse.json(
      { ok: false, status: 401, error: "All auth attempts failed", attempts },
      { status: 401, headers: withCORS() }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500, headers: withCORS() });
  }
}
