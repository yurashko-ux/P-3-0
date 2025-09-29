// web/app/api/debug/kv/route.ts
// GET  /api/debug/kv         -> показати, що бачимо в KV (env-прапори, індекси RO/WR, кількість елементів)
// GET  /api/debug/kv?seed=1  -> створити 1 тестову кампанію (WR-токен), повернути результат, показати індекс
//
// Це допоможе швидко з'ясувати, чому список порожній (часто причина — відсутній WR токен або різні неймспейси).

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaign:index';
const ITEM_KEY  = (id: string) => `campaign:${id}`;

function base() {
  return (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
}
function rdToken() {
  const rd = process.env.KV_REST_API_READ_ONLY_TOKEN || '';
  const wr = process.env.KV_REST_API_TOKEN || '';
  return rd || wr; // якщо RO нема — беремо WR для читання
}
function wrToken() {
  return process.env.KV_REST_API_TOKEN || '';
}

async function rest(path: string, token: string, init: RequestInit = {}) {
  const url = `${base()}/${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}`);
  return res;
}

async function lrange(key: string, token: string, start = 0, stop = -1) {
  try {
    const res = await rest(`lrange/${encodeURIComponent(key)}/${start}/${stop}`, token);
    const arr = await res.json().catch(() => []);
    return (arr as any[]).map(v => (typeof v === 'string' ? v : v?.value)).filter(Boolean);
  } catch (e) {
    return { error: String(e) };
  }
}

async function getRaw(key: string, token: string) {
  try {
    const res = await rest(`get/${encodeURIComponent(key)}`, token);
    return await res.text();
  } catch (e) {
    return null;
  }
}

async function setRaw(key: string, value: string, token: string) {
  await rest(`set/${encodeURIComponent(key)}`, token, { method: 'POST', body: value });
}
async function lpush(key: string, value: string, token: string) {
  await rest(`lpush/${encodeURIComponent(key)}`, token, { method: 'POST', body: JSON.stringify({ value }) });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const doSeed = url.searchParams.get('seed') === '1';

  const has = {
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    KV_REST_API_READ_ONLY_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
  };

  // 1) Прочитаємо індекс з RO і WR токеном (щоб зрозуміти різницю неймспейсів/прав)
  const idsRO = await lrange(INDEX_KEY, rdToken());
  const idsWR = await lrange(INDEX_KEY, wrToken());

  let seeded: any = null;

  // 2) Якщо seed=1 і є WR токен — створимо одну кампанію
  if (doSeed && wrToken()) {
    try {
      const id = Date.now().toString();
      const item = {
        id,
        name: 'UI-created',
        created_at: Number(id),
        active: false,
        base_pipeline_id: null,
        base_status_id: null,
        rules: {
          v1: { op: 'contains', value: 'ціна' },
          v2: { op: 'equals', value: 'привіт' },
        },
        v1_count: 0,
        v2_count: 0,
        exp_count: 0,
        deleted: false,
      };
      await setRaw(ITEM_KEY(id), JSON.stringify(item), wrToken());
      await lpush(INDEX_KEY, id, wrToken());
      seeded = { ok: true, id };
    } catch (e: any) {
      seeded = { ok: false, error: e?.message || String(e) };
    }
  }

  // 3) Зберемо кілька елементів за idRO (до 3 шт.), щоб побачити, чи читається JSON
  let sample: any[] = [];
  if (Array.isArray(idsRO)) {
    const pick = idsRO.slice(0, 3);
    for (const id of pick) {
      const raw = await getRaw(ITEM_KEY(id as string), rdToken());
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        if (!obj.id) obj.id = id;
        sample.push({ id, name: obj.name, created_at: obj.created_at, active: obj.active ?? false });
      } catch {}
    }
  }

  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    env: has,
    idsRO,
    idsWR,
    sample,
    seeded,
    hint: [
      'Якщо idsWR має значення, а idsRO — порожній: RO-токен вказує на інший неймспейс або його нема.',
      'Якщо обидва порожні — індекс порожній або WR-запис не спрацював.',
      'Додайте ?seed=1 до URL для створення однієї тестової кампанії через WR-токен.',
    ],
  });
}
