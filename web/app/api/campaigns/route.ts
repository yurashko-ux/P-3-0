// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** ===== Upstash REST (KV) ===== */
const URL = process.env.KV_REST_API_URL!;
const TOKEN = process.env.KV_REST_API_TOKEN!;
const hasKV = () => Boolean(URL && TOKEN);

async function kv(path: string, init?: RequestInit) {
  const r = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Пробуємо показати зрозумілу помилку
    throw new Error(`REST_ERROR ${r.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

const INDEX_KEY = 'campaigns:index:list';
const ITEM_KEY = (id: string | number) => `campaigns:${id}`;

/** Нормалізація індексу (раптом там є старі рядки типу ["id"]) */
function normalizeIndex(raw: any): string[] {
  const list: string[] = Array.isArray(raw?.result) ? raw.result : [];
  return list.map((v) => {
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'string') {
          return parsed[0];
        }
      } catch { /* ignore */ }
      return v;
    }
    return String(v);
  });
}

/** GET: повертаємо масив кампаній у порядку додавання (найсвіжіші зверху) */
export async function GET() {
  try {
    if (!hasKV()) {
      return NextResponse.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    // 1) зчитуємо індекс (LIST)
    const rawIdx = await kv(`/lrange/${encodeURIComponent(INDEX_KEY)}/0/-1`);
    const index = normalizeIndex(rawIdx);

    // 2) тягнемо кожен item окремо (надійно і просто)
    const items = await Promise.all(
      index.map(async (id) => {
        const res = await kv(`/get/${encodeURIComponent(ITEM_KEY(id))}`).catch(() => ({ result: null }));
        const raw = res?.result as string | null;
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          // страховка: додамо id, якщо його нема в тілі
          return { id, ...parsed };
        } catch {
          return null;
        }
      })
    );

    // 3) фільтр null і сортування за created_at (новіші зверху)
    const list = items
      .filter(Boolean) as Array<{ id: string; created_at?: number } & Record<string, any>>;
    list.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

    return NextResponse.json(
      { ok: true, count: list.length, items: list },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
