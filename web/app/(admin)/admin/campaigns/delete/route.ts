// web/app/(admin)/admin/campaigns/delete/route.ts
// HARD DELETE з KV + ремонт LIST-індексу.
// 1) DEL campaign:<id>
// 2) Прибираємо id з campaign:index (та legacy campaigns:index).
//    Якщо LREM не спрацювало — перечитуємо індекс, фільтруємо id і ПОВНІСТЮ перебудовуємо список.
// Без жодного soft-delete.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaign:index';
const LEGACY_INDEX = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaign:${id}`;

function BASE() {
  return (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
}
function WR() {
  return process.env.KV_REST_API_TOKEN || '';
}

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE()}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WR()}` },
    cache: 'no-store',
  });
  return res;
}

// ----- універсальний парсер відповіді lrange -----
async function lr(key: string): Promise<string[]> {
  try {
    const r = await rest(`lrange/${encodeURIComponent(key)}/0/-1`);
    const txt = await r.text();
    let payload: any = null;
    try { payload = JSON.parse(txt); } catch { payload = txt; }

    let arr: any[] = [];
    if (Array.isArray(payload)) arr = payload;
    else if (payload && Array.isArray(payload.result)) arr = payload.result;
    else if (payload && Array.isArray(payload.data)) arr = payload.data;
    else if (typeof payload === 'string') {
      try {
        const again = JSON.parse(payload);
        if (Array.isArray(again)) arr = again;
        else if (again && Array.isArray(again.result)) arr = again.result;
        else if (again && Array.isArray(again.data)) arr = again.data;
      } catch {}
    }

    return arr
      .map((x: any) =>
        typeof x === 'string' ? x : (x?.value ?? x?.member ?? x?.id ?? '')
      )
      .filter(Boolean)
      .map(String);
  } catch {
    return [];
  }
}

// перебудова LIST індексу (збережемо порядок через RPUSH)
async function rebuildIndex(key: string, ids: string[]) {
  // почистити індекс
  await rest(`del/${encodeURIComponent(key)}`, { method: 'POST' }).catch(() => null);
  if (ids.length === 0) return;
  // RPUSH по черзі, щоб зберегти існуючий порядок
  for (const id of ids) {
    await rest(`rpush/${encodeURIComponent(key)}`, {
      method: 'POST',
      body: JSON.stringify({ value: id }),
    }).catch(() => null);
  }
}

// спроба прибрати елемент з індексу через LREM; повертає true, якщо щось змінилося
async function tryLrem(key: string, id: string) {
  const before = await lr(key);
  await rest(`lrem/${encodeURIComponent(key)}/0`, {
    method: 'POST',
    body: JSON.stringify({ value: id }),
  }).catch(() => null);
  const after = await lr(key);
  return after.length !== before.length;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  let id = (url.searchParams.get('id') || '').trim().replace(/^"+|"+$/g, '');
  if (!id || !BASE() || !WR()) {
    url.pathname = '/admin/campaigns'; url.search = '?deleted=1';
    return NextResponse.redirect(url, 303);
  }

  const itemKey = ITEM_KEY(id);

  // 1) DEL ключ елемента
  await rest(`del/${encodeURIComponent(itemKey)}`, { method: 'POST' }).catch(() => null);

  // 2) Прибрати з основного індексу — спочатку LREM, а якщо ні — повна перебудова
  let okMain = await tryLrem(INDEX_KEY, id);
  if (!okMain) {
    const ids = (await lr(INDEX_KEY)).filter((x) => x !== id);
    await rebuildIndex(INDEX_KEY, ids);
  }

  // 3) Те саме для legacy-індексу
  let okLegacy = await tryLrem(LEGACY_INDEX, id);
  if (!okLegacy) {
    const idsL = (await lr(LEGACY_INDEX)).filter((x) => x !== id);
    await rebuildIndex(LEGACY_INDEX, idsL);
  }

  // 4) Переконатися, що ключ точно зник (другий DEL — ідempotent)
  await rest(`del/${encodeURIComponent(itemKey)}`, { method: 'POST' }).catch(() => null);

  // 5) назад у список
  url.pathname = '/admin/campaigns';
  url.search = '?deleted=1';
  return NextResponse.redirect(url, 303);
}
