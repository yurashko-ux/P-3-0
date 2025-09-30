// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { kvRead, kvWrite } from '@/lib/kv'; // очікуємо, що є обгортки як у нотатках (lrange/getRaw і т.п.)

const INDEX_KEY = 'campaign:index';
const ITEM_KEY = (id: string) => `campaign:${id}`;

/** Допоміжне: дістаємо ADMIN_PASS із env і з реквеста */
function getAdminPassFromReq(req: NextRequest) {
  const adminEnv = process.env.ADMIN_PASS || '';
  const h = req.headers.get('x-admin-token') || '';
  const c = cookies().get('admin_token')?.value || cookies().get('admin_pass')?.value || '';
  return { ok: !!adminEnv && (h === adminEnv || c === adminEnv), adminEnv };
}

/** Нормалізуємо ID, що можуть бути:
 * - '17590...'
 * - '{"value":"17590..."}'
 * - { value: '17590...' }
 */
function normalizeId(raw: unknown): string | null {
  if (!raw) return null;
  try {
    if (typeof raw === 'string') {
      // якщо це JSON з полем value
      if (raw.trim().startsWith('{')) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.value === 'string') return obj.value;
      }
      return raw;
    }
    if (typeof raw === 'object' && (raw as any).value) {
      return String((raw as any).value);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Безпечне lrange із запасним читанням через WR у разі помилки/порожньо */
async function safeLRange(key: string): Promise<string[]> {
  // спершу RO
  try {
    const ids = (await kvRead.lrange(key, 0, -1)) as any;
    if (Array.isArray(ids) && ids.length) return ids as string[];
  } catch {
    /* ignore */
  }
  // fallback — WR
  try {
    const ids = (await kvWrite.lrange(key, 0, -1)) as any;
    if (Array.isArray(ids)) return ids as string[];
  } catch {
    /* ignore */
  }
  return [];
}

/** Безпечний get: RO → WR */
async function safeGet(key: string): Promise<string | null> {
  try {
    const v = (await kvRead.getRaw(key)) as string | null;
    if (v) return v;
  } catch {
    /* ignore */
  }
  try {
    const v = (await kvWrite.getRaw(key)) as string | null;
    if (v) return v;
  } catch {
    /* ignore */
  }
  return null;
}

export const dynamic = 'force-dynamic';

/** GET /api/campaigns — стабільний список без 401/порожніх відповідей */
export async function GET(req: NextRequest) {
  // Жорстко перевіряємо адмін-доступ (інакше UI отримує 401 та показує нуль елементів)
  const { ok } = getAdminPassFromReq(req);
  if (!ok) {
    return NextResponse.json({ ok: false, items: [], reason: 'unauthorized' }, { status: 401 });
  }

  // 1) ID із індексу з нормалізацією
  const rawIds = await safeLRange(INDEX_KEY);
  const ids = rawIds
    .map(normalizeId)
    .filter((x): x is string => !!x);

  // 2) Підтягнемо кожен item (RO → WR), при цьому ігноруємо поламані JSON
  const items: any[] = [];
  for (const id of ids) {
    const raw = await safeGet(ITEM_KEY(id));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      // підправимо дефолти для UI
      parsed.id = String(parsed.id ?? id);
      parsed.v1_count = parsed.v1_count ?? 0;
      parsed.v2_count = parsed.v2_count ?? 0;
      parsed.exp_count = parsed.exp_count ?? 0;
      items.push(parsed);
    } catch {
      // якщо лежав не-JSON — пропускаємо
      continue;
    }
  }

  return NextResponse.json({ ok: true, count: items.length, items }, { status: 200 });
}

/** POST /api/campaigns — створення (залишено як було; додаємо лише адмін-перевірку) */
export async function POST(req: NextRequest) {
  const { ok } = getAdminPassFromReq(req);
  if (!ok) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const id = String(Date.now());
    const item = {
      id,
      name: String(body?.name ?? 'UI-created'),
      created_at: Date.now(),
      active: body?.active ?? false,
      base_pipeline_id: Number(body?.base_pipeline_id ?? 0) || undefined,
      base_status_id: Number(body?.base_status_id ?? 0) || undefined,
      base_pipeline_name: body?.base_pipeline_name ?? null,
      base_status_name: body?.base_status_name ?? null,
      rules: body?.rules ?? {},
      exp: body?.exp ?? {},
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    // запис
    await kvWrite.setRaw(ITEM_KEY(id), JSON.stringify(item));
    await kvWrite.lpush(INDEX_KEY, id);

    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e: any) {
    console.error('POST /api/campaigns failed', e);
    return NextResponse.json({ ok: false, reason: 'KV write failed' }, { status: 500 });
  }
}

/** DELETE /api/campaigns?id=... — м’яке або повне видалення */
export async function DELETE(req: NextRequest) {
  const { ok } = getAdminPassFromReq(req);
  if (!ok) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ ok: false, reason: 'missing id' }, { status: 400 });

  try {
    // видаляємо item
    try {
      await kvWrite.del?.(ITEM_KEY(id));
    } catch {
      // якщо немає del у вашій обгортці — затираємо пустим JSON
      await kvWrite.setRaw(ITEM_KEY(id), '');
    }

    // відрізаємо з індексу (LIST → LREM)
    try {
      await kvWrite.lrem?.(INDEX_KEY, 0, id);
    } catch {
      // якщо немає lrem у вашій обгортці— ігноруємо (UI та GET уже не зламаються)
    }

    return NextResponse.json({ ok: true, id }, { status: 200 });
  } catch (e: any) {
    console.error('DELETE /api/campaigns failed', e);
    return NextResponse.json({ ok: false, reason: 'delete failed' }, { status: 500 });
  }
}
