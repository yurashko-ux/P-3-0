// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kvRead, kvWrite } from '@/lib/kv';

const INDEX_KEY = 'campaign:index';
const ITEM_KEY = (id: string) => `campaign:${id}`;

export const dynamic = 'force-dynamic';

function authOk(req: NextRequest) {
  const env = process.env.ADMIN_PASS || '';
  if (!env) return false;
  const h = req.headers.get('x-admin-token') || '';
  const c =
    cookies().get('admin_token')?.value ||
    cookies().get('admin_pass')?.value ||
    '';
  return h === env || c === env;
}

function normalizeId(raw: unknown): string | null {
  if (!raw) return null;
  try {
    if (typeof raw === 'string') {
      if (raw.trim().startsWith('{')) {
        const o = JSON.parse(raw);
        if (o && typeof o.value === 'string') return o.value;
      }
      return raw;
    }
    if (typeof raw === 'object' && (raw as any)?.value) {
      return String((raw as any).value);
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function safeLRange(key: string): Promise<string[]> {
  try {
    const v = (await kvRead.lrange(key, 0, -1)) as any;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

async function safeGet(key: string): Promise<string | null> {
  try {
    return (await kvRead.getRaw(key)) as string | null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, items: [] }, { status: 401 });
  }

  const rawIds = await safeLRange(INDEX_KEY);
  const ids = rawIds
    .map(normalizeId)
    .filter((x): x is string => !!x);

  const items: any[] = [];
  for (const id of ids) {
    const raw = await safeGet(ITEM_KEY(id));
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj?.deleted) continue; // soft-delete
      obj.id = String(obj.id ?? id);
      obj.v1_count = obj.v1_count ?? 0;
      obj.v2_count = obj.v2_count ?? 0;
      obj.exp_count = obj.exp_count ?? 0;
      items.push(obj);
    } catch {
      continue;
    }
  }

  return NextResponse.json({ ok: true, count: items.length, items });
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const body = await req.json();
    // у вашій обгортці є createCampaign — користуємось нею
    if (typeof kvWrite.createCampaign === 'function') {
      const saved = await kvWrite.createCampaign(body);
      return NextResponse.json({ ok: true, item: saved }, { status: 200 });
    }

    // запасний варіант (на випадок змін у lib)
    const id = String(Date.now());
    const item = {
      id,
      name: String(body?.name ?? 'UI-created'),
      created_at: Date.now(),
      active: !!body?.active,
      rules: body?.rules ?? {},
      exp: body?.exp ?? {},
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };
    await kvWrite.setRaw(ITEM_KEY(id), JSON.stringify(item));
    await kvWrite.lpush(INDEX_KEY, id);
    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e) {
    console.error('POST /api/campaigns failed', e);
    return NextResponse.json({ ok: false, reason: 'KV write failed' }, { status: 500 });
  }
}

// Soft delete: ставимо deleted: true та перезаписуємо item.
// Не використовуємо lrem/del, бо їх немає в kvWrite typings.
export async function DELETE(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) {
    return NextResponse.json({ ok: false, reason: 'missing id' }, { status: 400 });
  }

  try {
    const raw = await safeGet(ITEM_KEY(id));
    if (!raw) return NextResponse.json({ ok: true, id }); // id вже «не видно»

    let obj: any;
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = { id };
    }
    obj.deleted = true;
    await kvWrite.setRaw(ITEM_KEY(id), JSON.stringify(obj));
    return NextResponse.json({ ok: true, id }, { status: 200 });
  } catch (e) {
    console.error('DELETE /api/campaigns failed', e);
    return NextResponse.json({ ok: false, reason: 'delete failed' }, { status: 500 });
  }
}
