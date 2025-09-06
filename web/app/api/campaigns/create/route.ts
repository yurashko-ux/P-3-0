// web/app/api/campaigns/create/route.ts
import { NextResponse } from 'next/server';

const KV_URL = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;

type Body = {
  name: string;
  base_pipeline_id: string;
  base_status_id: string;
  to_pipeline_id: string;
  to_status_id: string;
  expiration_days: number;
};

async function kvGet(key: string) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`KV GET ${key} -> ${r.status}`);
  const j = await r.json();
  return j?.result ?? null;
}

async function kvSet(key: string, value: string) {
  const r = await fetch(
    `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    }
  );
  if (!r.ok) throw new Error(`KV SET ${key} -> ${r.status}`);
}

export async function POST(req: Request) {
  try {
    if (!KV_URL || !KV_TOKEN) {
      return NextResponse.json(
        { ok: false, error: 'KV env vars missing' },
        { status: 500 }
      );
    }

    const body = (await req.json()) as Body;
    const {
      name,
      base_pipeline_id,
      base_status_id,
      to_pipeline_id,
      to_status_id,
      expiration_days,
    } = body || ({} as Body);

    if (
      !name?.trim() ||
      !base_pipeline_id ||
      !base_status_id ||
      !to_pipeline_id ||
      !to_status_id ||
      (!Number.isFinite(expiration_days) && expiration_days !== 0)
    ) {
      return NextResponse.json(
        { ok: false, error: 'invalid payload' },
        { status: 400 }
      );
    }

    let raw = await kvGet('campaigns');
    let items: any[] = [];
    if (typeof raw === 'string' && raw.length) {
      try {
        items = JSON.parse(raw);
        if (!Array.isArray(items)) items = [];
      } catch {
        items = [];
      }
    }

    const item = {
      id: `cmp_${Date.now()}`,
      created_at: new Date().toISOString(),
      name: name.trim(),
      base: { pipeline_id: String(base_pipeline_id), status_id: String(base_status_id) },
      to: { pipeline_id: String(to_pipeline_id), status_id: String(to_status_id) },
      expiration_days: Number(expiration_days) || 0,
    };

    items.push(item);
    await kvSet('campaigns', JSON.stringify(items));

    return NextResponse.json({ ok: true, item });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'unexpected error' },
      { status: 500 }
    );
  }
}
