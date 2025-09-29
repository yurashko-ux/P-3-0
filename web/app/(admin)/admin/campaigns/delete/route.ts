// web/app/(admin)/admin/campaigns/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';

const BASE = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const WR_TOKEN = process.env.KV_REST_API_TOKEN || '';
const RD_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || WR_TOKEN;

const INDEX_KEY = 'campaign:index';
const ITEM_KEY = (id: string) => `campaign:${id}`;

function headersAuth(ro = false) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ro ? RD_TOKEN : WR_TOKEN}`,
  };
}

async function restGet(path: string, ro = true) {
  const res = await fetch(`${BASE}/${path}`, { headers: headersAuth(ro), cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res;
}
async function restPost(path: string, body: any, ro = false) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: headersAuth(ro),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res;
}

async function kvDelKey(key: string) {
  try { await restPost(`del/${encodeURIComponent(key)}`, '', false); } catch {}
}

// Пробуємо різні варіанти LREM з різними назвами поля у body
async function kvLRemAny(key: string, memberRaw: string) {
  const variants = [
    { path: `lrem/${encodeURIComponent(key)}/0`, body: { value: memberRaw } },
    { path: `lrem/${encodeURIComponent(key)}/0`, body: { element: memberRaw } },
    { path: `lrem/${encodeURIComponent(key)}/0`, body: { member: memberRaw } },
  ];
  for (const v of variants) {
    try { await restPost(v.path, v.body, false); } catch {}
  }
}

async function kvLRangeAll(key: string): Promise<string[]> {
  const res = await restGet(`lrange/${encodeURIComponent(key)}/0/-1`, true).catch(() => null);
  if (!res) return [];
  let txt = ''; try { txt = await res.text(); } catch { return []; }
  let data: any = null;
  try { data = JSON.parse(txt); } catch { data = txt; }

  let arr: any[] = [];
  if (Array.isArray(data)) arr = data;
  else if (data && Array.isArray(data.result)) arr = data.result;
  else if (data && Array.isArray(data.data)) arr = data.data;
  else if (typeof data === 'string') {
    try {
      const d2 = JSON.parse(data);
      if (Array.isArray(d2)) arr = d2;
      else if (d2 && Array.isArray(d2.result)) arr = d2.result;
      else if (d2 && Array.isArray(d2.data)) arr = d2.data;
    } catch {}
  }

  return arr
    .map((x: any) => (typeof x === 'string' ? x : (x?.value ?? x?.member ?? x?.id ?? '')))
    .filter(Boolean)
    .map(String);
}

async function kvLPushMany(key: string, values: string[]) {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    try { await restPost(`lpush/${encodeURIComponent(key)}`, { value: v }, false); } catch {}
  }
}

// Агресивна нормалізація до числового id (timestamp у вигляді рядка)
function normalizeId(raw: any, depth = 8): string {
  if (raw == null || depth <= 0) return '';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') {
    let s = raw.trim();
    for (let i = 0; i < 6; i++) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string' || typeof parsed === 'number') {
          return normalizeId(parsed, depth - 1);
        }
        if (parsed && typeof parsed === 'object') {
          const cand = (parsed as any).value ?? (parsed as any).id ?? (parsed as any).member ?? '';
          if (cand) return normalizeId(cand, depth - 1);
        }
        break;
      } catch { break; }
    }
    s = s.replace(/\\+/g, '').replace(/^"+|"+$/g, '');
    const m = s.match(/\d{10,}/);
    return m ? m[0] : '';
  }
  if (typeof raw === 'object') {
    const cand = (raw as any).value ?? (raw as any).id ?? (raw as any).member ?? '';
    return normalizeId(cand, depth - 1);
  }
  return '';
}

export async function GET(req: NextRequest) {
  const back = new URL('/admin/campaigns?deleted=1', req.url);
  try {
    if (!BASE || !WR_TOKEN) return NextResponse.redirect(back);

    const url = new URL(req.url);
    const idRaw = url.searchParams.get('id') || '';
    if (!idRaw) return NextResponse.redirect(back);

    const idNorm = normalizeId(idRaw);
    // 1) спробувати LREM по «сирому» значенню, щоб прибрати з індексу
    await kvLRemAny(INDEX_KEY, idRaw);
    // 2) спробувати LREM по нормалізованому значенню (раптом в індексі лежить «чисте» число)
    if (idNorm) await kvLRemAny(INDEX_KEY, idNorm);

    // 3) видалити сам елемент
    if (idNorm) await kvDelKey(ITEM_KEY(idNorm));

    // 4) перевірити індекс; якщо все ще є цей елемент — перебудувати без нього
    const ids = await kvLRangeAll(INDEX_KEY);
    const stillHas = ids.some((r) => normalizeId(r) === idNorm || r === idRaw);
    if (stillHas) {
      const kept = ids.filter((r) => {
        const n = normalizeId(r);
        return !(n && idNorm && n === idNorm) && r !== idRaw;
      });
      await kvDelKey(INDEX_KEY);
      if (kept.length) await kvLPushMany(INDEX_KEY, kept);
    }

    return NextResponse.redirect(back);
  } catch {
    return NextResponse.redirect(back);
  }
}
