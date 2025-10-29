// web/app/api/keycrm/search/by-title/route.ts
// Пошук card_id по title, що містить/дорівнює "Чат з {full_name}"
// Виклик приклад:
//  /api/keycrm/search/by-title?full_name=Viktoria%20Kolachnyk&pipeline_id=1&status_id=38&per_page=50&max_pages=40&pass=11111
//
// Якщо pipeline_id/status_id не передані — шукаємо по всіх картках.

import { NextRequest, NextResponse } from 'next/server';
import { baseUrl, ensureBearer } from '../../_common';

export const dynamic = 'force-dynamic';

type AnyObj = Record<string, any>;

function BASE() {
  return baseUrl();
}
function TOKEN() {
  return ensureBearer(
    process.env.KEYCRM_BEARER ||
      process.env.KEYCRM_API_TOKEN ||
      process.env.KEYCRM_TOKEN ||
      ''
  );
}

async function assertAdmin(req: NextRequest) {
  const u = new URL(req.url);
  const passParam = u.searchParams.get('pass') || '';
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if (!expected) return; // якщо нема пароля в env — пропускаємо
  if (bearer === expected || passParam === expected) return;
  throw new Error('Unauthorized');
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}
function buildTitleVariants(fullName: string) {
  const n = norm(fullName);
  return [
    `чат з ${n}`,            // укр
    `чат з ${n}`,            // дубль (інколи різні пробіли)
    `chat with ${n}`,        // англ
    n,                       // на всяк — чисте ім’я
  ];
}

async function kcListCardsPage(params: {
  page: number; per_page: number;
  pipeline_id?: number; status_id?: number;
}) {
  const url = new URL(`${BASE()}/pipelines/cards`);
  url.searchParams.set('page', String(params.page));
  url.searchParams.set('per_page', String(params.per_page));
  if (params.pipeline_id) url.searchParams.set('pipeline_id', String(params.pipeline_id));
  if (params.status_id)   url.searchParams.set('status_id', String(params.status_id));

  const token = TOKEN();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  const res = await fetch(url.toString(), {
    headers,
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  let body: AnyObj;
  try { body = JSON.parse(text); } catch { body = {}; }
  return body as {
    data: AnyObj[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

export async function GET(req: NextRequest) {
  try {
    await assertAdmin(req);
    const u = new URL(req.url);
    const full_name = (u.searchParams.get('full_name') || '').trim();
    if (!full_name) {
      return NextResponse.json({ ok: false, error: 'full_name is required' }, { status: 400 });
    }
    const pipeline_id = u.searchParams.get('pipeline_id');
    const status_id   = u.searchParams.get('status_id');
    const per_page    = Number(u.searchParams.get('per_page') || 50);
    const max_pages   = Math.min(Number(u.searchParams.get('max_pages') || 60), 200);

    const vPipeline = pipeline_id ? Number(pipeline_id) : undefined;
    const vStatus   = status_id   ? Number(status_id)   : undefined;

    const variants = buildTitleVariants(full_name);
    const variantsSet = new Set(variants);

    let page = 1;
    let found: AnyObj | null = null;
    let lastPage = 1;
    let scanned = 0;

    while (page <= max_pages) {
      const list = await kcListCardsPage({ page, per_page, pipeline_id: vPipeline, status_id: vStatus });
      lastPage = list.last_page || lastPage;

      for (const it of list.data || []) {
        const t = norm(String(it.title || ''));
        scanned++;
        // рівність або входження будь-якого з варіантів
        const hit =
          [...variantsSet].some(v => t === v || t.includes(v));
        if (hit) {
          found = {
            id: Number(it.id),
            pipeline_id: Number(it.pipeline_id ?? it?.status?.pipeline_id ?? 0) || null,
            status_id: Number(it.status_id ?? it?.status?.id ?? 0) || null,
            title: String(it.title || ''),
          };
          break;
        }
      }
      if (found) break;
      page++;
      if (page > (list.last_page || 1)) break;
      // невеликий throttle, щоб не ловити 429
      await new Promise(r => setTimeout(r, 120));
    }

    return NextResponse.json({
      ok: true,
      found_card_id: found?.id ?? null,
      found,
      used: {
        full_name,
        variants: [...variantsSet],
        pipeline_id: vPipeline ?? null,
        status_id: vStatus ?? null,
        per_page,
        max_pages,
      },
      stats: { scanned, pages_used: page, last_page: lastPage },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
