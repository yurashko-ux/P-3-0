// app/api/kv/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnyObj = { [k: string]: any };

// Просте in-memory KV (скидається при кожному деплої)
declare global { var __KV__: Map<string, AnyObj> | undefined; }
const KV: Map<string, AnyObj> = (globalThis as any).__KV__ ?? new Map();
(globalThis as any).__KV__ = KV;

function keyFor(usernameRaw: string) {
  const username = (usernameRaw || "").trim().toLowerCase();
  return `ig:${username}`;
}

function withCORS(init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-pass, x-admin-pass-b64");
  return headers;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCORS() });
}

// GET /api/kv/lookup?username=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("username") || "").trim().toLowerCase();
  if (!username) {
    return NextResponse.json({ ok: false, error: "username required" }, { status: 400, headers: withCORS() });
  }
  const k = keyFor(username);
  const payload = KV.get(k);
  if (!payload) {
    return NextResponse.json({ ok: false, found: false, key: k }, { status: 404, headers: withCORS() });
  }
  return NextResponse.json({ ok: true, key: k, payload }, { status: 200, headers: withCORS() });
}

// POST /api/kv/lookup  (створити/оновити запис)
export async function POST(req: NextRequest) {
  try {
    const adminPassEnv = String(process.env.ADMIN_PASS ?? process.env.ADMIN_PASSWORD ?? "");
    const hdrPlain = req.headers.get("x-admin-pass") ?? "";
    const hdrB64 = req.headers.get("x-admin-pass-b64") ?? "";

    let provided = hdrPlain;
    if (!provided && hdrB64) {
      try { provided = Buffer.from(hdrB64, "base64").toString("utf8"); } catch {}
    }
    if (!adminPassEnv || provided !== adminPassEnv) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized (x-admin-pass or x-admin-pass-b64 invalid)" },
        { status: 401, headers: withCORS() }
      );
    }

    let body: AnyObj = {};
    try { body = await req.json(); } catch {}

    const username = String(body.username ?? body.instagram_username ?? "").trim().toLowerCase();
    if (!username) {
      return NextResponse.json({ ok: false, error: "username required" }, { status: 400, headers: withCORS() });
    }

    const k = keyFor(username);
    const now = Date.now();

    let payload: AnyObj | null = null;
    if (body.payload && typeof body.payload === "object") {
      payload = { ...body.payload, instagram_username_lc: username, updated_at: now };
    } else if (body.card_id || body.lead_id) {
      const card_id = Number(body.card_id ?? body.lead_id);
      if (!Number.isFinite(card_id)) {
        return NextResponse.json(
          { ok: false, error: "card_id/lead_id must be a number" },
          { status: 400, headers: withCORS() }
        );
      }
      payload = {
        instagram_username_lc: username,
        card_id,
        pipeline_id: body.pipeline_id ?? null,
        status_id: body.status_id ?? null,
        title_lc: body.title_lc ?? null,
        updated_at: now,
      };
    } else {
      return NextResponse.json(
        { ok: false, error: "Provide payload OR card_id/lead_id" },
        { status: 400, headers: withCORS() }
      );
    }

    KV.set(k, payload);
    return NextResponse.json({ ok: true, saved: true, key: k, payload }, { status: 200, headers: withCORS() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Unknown error" },
      { status: 500, headers: withCORS() });
  }
}
