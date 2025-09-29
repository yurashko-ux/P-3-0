// web/app/(admin)/admin/campaigns/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';

const BASE = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const WR_TOKEN = process.env.KV_REST_API_TOKEN || '';
const RD_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || WR_TOKEN;

const INDEX_KEY = 'campaign:index';
const ITEM_KEY = (id: string) => `campaign:${id}`;

function authHeaders(ro = false) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ro ? RD_TOKEN : WR_TOKEN}`,
  };
}

async function kvGet(path: string, ro = true) {
  const res = await fetch(`${BASE}/${path}`, { headers: authHeaders(ro), cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res;
}

async function kvPost(path: string, body: any, ro = false) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: authHeaders(ro),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res;
}

async function kvDelKey(key: string) {
  // del/{key}
  await kvPost(`del/${encodeURIComponent(key)}`, '', false).catch(() => {});
}

// LRANGE з різними форматами, що повертає REST
async function kvLRangeAll(key: string): Promise<string[]> {
  const res = await kvGet(`lrange/${encodeURIComponent(key)}/0/-1`, true).catch(() => null);
  if (!res) return [];
  let txt = '';
  try { txt = await res.text(); } catch { return []; }
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
    } catch { /* ignore */ }
  }

  return arr
    .map((x: any) => (typeof x === 'string' ? x : (x?.value ?? x?.member ?? x?.id ?? '')))
    .filter(Boolean)
    .map(String);
}

// LPUSH багато значень у правильному порядку (новіші зліва)
// Для відновлення черги ми робимо LPUSH у зворотному порядку.
async function kvLPushMany(key: string, values: string[]) {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    await kvPost(`lpush/${encodeURIComponent(key)}`, { value: v }, false).catch(() => {});
  }
}

// Нормалізація будь-якого «битого» id до числового рядка
function normalizeIdRaw(raw: any, depth = 8): string {
  if (raw == null || depth <= 0) return '';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') {
    let s = raw.trim();
    // Багаторазове розпарсення екранованих JSON-рядків
    for (let i = 0; i < 6; i++) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string' || typeof parsed === 'number') {
          return normalizeIdRaw(parsed, depth - 1);
        }
        if (parsed && typeof parsed === 'object') {
          const cand = (parsed as any).value ?? (parsed as any).id ?? (parsed as any).member ?? '';
          if (cand) return normalizeIdRaw(cand, depth - 1);
        }
        break;
      } catch { break; }
    }
    // Прибрати екранування/лапки
    s = s.replace(/\\+/g, '').replace(/^"+|"+$/g, '');
    const m = s.match(/\d{10,}/); // шукаємо довгий timestamp
    return m ? m[0] : '';
  }
  if (typeof raw === 'object') {
    const cand = (raw as any).value ?? (raw as any).id ?? (raw as any).member ?? '';
    return normalizeIdRaw(cand, depth - 1);
  }
  return '';
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qId = url.searchParams.get('id') || '';
    if (!BASE || !WR_TOKEN || !RD_TOKEN) {
      return NextResponse.redirect(new URL('/admin/campaigns?deleted=1', req.url));
    }

    // 1) Нормалізуємо id із параметра
    const targetId = normalizeIdRaw(qId);
    if (!targetId) {
      // Якщо нічого не розпізнали — просто повертаємось (щоб UI не зависав)
      return NextResponse.redirect(new URL('/admin/campaigns?deleted=1', req.url));
    }

    // 2) Зчитуємо індекс
    const ids = await kvLRangeAll(INDEX_KEY);

    // 3) Видаляємо сам елемент (навіть якщо його ключу немає — ок)
    await kvDelKey(ITEM_KEY(targetId));

    // 4) Перебудовуємо індекс без цього елемента
    //    Порівнюємо targetId з нормалізацією кожного рядка з індексу
    const kept: string[] = [];
    for (const raw of ids) {
      const norm = normalizeIdRaw(raw);
      if (norm && norm === targetId) continue; // пропускаємо саме цей
      kept.push(raw);
    }

    // Спочатку видаляємо старий індекс (як LIST, це звичайний ключ)
    await kvDelKey(INDEX_KEY);
    // Потім додаємо назад решту
    if (kept.length) {
      await kvLPushMany(INDEX_KEY, kept);
    }

    // 5) Повертаємось на список із флагом
    const back = new URL('/admin/campaigns?deleted=1', req.url);
    return NextResponse.redirect(back);
  } catch (e) {
    // Навіть у разі помилки — не блокуємо UX
    const back = new URL('/admin/campaigns?deleted=1', req.url);
    return NextResponse.redirect(back);
  }
}
