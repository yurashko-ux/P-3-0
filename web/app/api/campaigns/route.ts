// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";

// ===== KV (Upstash REST) helpers =====
const BASE = process.env.KV_REST_API_URL!;
const TOKEN = process.env.KV_REST_API_TOKEN!;
const ADMIN = process.env.ADMIN_PASS || "11111";

function authHdr() {
  return { Authorization: `Bearer ${TOKEN}` };
}

async function kvSet(key: string, value: string) {
  const r = await fetch(`${BASE}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { ...authHdr() },
    body: value,
    cache: "no-store",
  });
  return r.json().catch(() => ({}));
}

async function kvGet(key: string) {
  const r = await fetch(`${BASE}/get/${encodeURIComponent(key)}`, {
    headers: { ...authHdr() },
    cache: "no-store",
  });
  return r.json().catch(() => ({})); // { result: string | null }
}

async function kvDel(key: string) {
  const r = await fetch(`${BASE}/del/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { ...authHdr() },
    cache: "no-store",
  });
  return r.json().catch(() => ({}));
}

async function kvZadd(key: string, score: number, member: string) {
  const r = await fetch(
    `${BASE}/zadd/${encodeURIComponent(key)}/${encodeURIComponent(
      String(score)
    )}/${encodeURIComponent(member)}`,
    {
      method: "POST",
      headers: { ...authHdr() },
      cache: "no-store",
    }
  );
  return r.json().catch(() => ({}));
}

async function kvZrem(key: string, member: string) {
  const r = await fetch(
    `${BASE}/zrem/${encodeURIComponent(key)}/${encodeURIComponent(member)}`,
    {
      method: "POST",
      headers: { ...authHdr() },
      cache: "no-store",
    }
  );
  return r.json().catch(() => ({}));
}

async function kvZrangeRevAll(key: string) {
  // /zrange/{key}/start/stop?rev=true -> { result: string[] }
  const r = await fetch(
    `${BASE}/zrange/${encodeURIComponent(key)}/0/-1?rev=true`,
    { headers: { ...authHdr() }, cache: "no-store" }
  );
  return r.json().catch(() => ({ result: [] as string[] }));
}

// ===== Keys =====
const INDEX_KEY = "campaigns:index";
const ITEM_KEY = (id: string | number) => `campaigns:${id}`;

// ===== Types (мінімально) =====
type Rule = { op?: "contains" | "equals"; value?: string };
type Rules = { v1?: Rule; v2?: Rule };
type Campaign = {
  id?: string | number;
  name?: string;
  created_at?: number;
  active?: boolean;
  base_pipeline_id?: number | string;
  base_status_id?: number | string;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: Rules;
  exp?: Record<string, any>;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

export const dynamic = "force-dynamic";

// ===== GET /api/campaigns — список =====
export async function GET() {
  try {
    const zr = await kvZrangeRevAll(INDEX_KEY);
    const ids = (zr?.result || []) as string[];

    const items: Campaign[] = [];
    // малі обсяги — читаємо по одному, щоб уникнути mget
    for (const id of ids) {
      const g = await kvGet(ITEM_KEY(id));
      if (g && typeof g.result === "string") {
        try {
          const obj = JSON.parse(g.result) as Campaign;
          obj.id = id;
          items.push(obj);
        } catch {}
      }
    }

    return NextResponse.json(
      { ok: true, count: items.length, items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

// ===== POST /api/campaigns — створення =====
export async function POST(req: Request) {
  // простий захист
  const admin = req.headers.get("x-admin-token");
  if (!admin || admin !== ADMIN) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: missing or invalid admin token" },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json()) as Campaign;

    const id = Date.now();
    const now = id;

    const item: Campaign = {
      name: body.name || "Campaign",
      created_at: now,
      active: true,
      base_pipeline_id: body.base_pipeline_id ?? 0,
      base_status_id: body.base_status_id ?? 0,
      base_pipeline_name:
        (body as any).base_pipeline_name ?? null,
      base_status_name: (body as any).base_status_name ?? null,
      rules: {
        v1: body.rules?.v1 ?? { op: "contains", value: "" },
        v2: body.rules?.v2 ?? { op: "contains", value: "" },
      },
      exp: body.exp ?? {},
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    // save item
    const setRes = await kvSet(ITEM_KEY(id), JSON.stringify(item));
    // add to index
    const zaddRes = await kvZadd(INDEX_KEY, now, String(id));

    return NextResponse.json(
      { ok: true, id: String(id), setRes, zaddRes, item },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

// (опційно) DELETE /api/campaigns?id=123 — видалення
export async function DELETE(req: Request) {
  const admin = req.headers.get("x-admin-token");
  if (!admin || admin !== ADMIN) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: missing or invalid admin token" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing id" },
      { status: 400 }
    );
  }

  try {
    const del1 = await kvDel(ITEM_KEY(id));
    const del2 = await kvZrem(INDEX_KEY, id);
    return NextResponse.json(
      { ok: true, id, del1, del2 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
