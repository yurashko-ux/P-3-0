// web/app/api/keycrm/statuses/route.ts
import { NextResponse } from 'next/server';

const API = process.env.KEYCRM_API_URL!;
const BEARER = process.env.KEYCRM_BEARER!;

function asArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    for (const k of ['items', 'data', 'result', 'list', 'rows']) {
      if (Array.isArray((x as any)[k])) return (x as any)[k];
    }
  }
  return [];
}

function toItems(arr: any[]) {
  const out: { id: string; title: string; pipeline_id?: string }[] = [];
  for (const s of arr) {
    const id = s?.id ?? s?.status_id ?? s?.value ?? s?.key;
    const title = s?.title ?? s?.name ?? s?.label ?? (id != null ? `#${id}` : '');
    const pid = s?.pipeline_id ?? s?.pipeline ?? null;
    if (id != null) out.push({ id: String(id), title: String(title), pipeline_id: pid ? String(pid) : undefined });
  }
  // унікалізація
  const uniq = new Map(out.map((it) => [it.id, it]));
  return Array.from(uniq.values());
}

async function hit(url: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${BEARER}` }, cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  return toItems(asArray(j) || asArray(j?.items) || asArray(j?.data) || asArray(j?.result));
}

export async function GET(req: Request) {
  try {
    if (!API || !BEARER)
      return NextResponse.json({ ok: false, error: 'Missing KEYCRM env' }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const pipeline_id =
      (searchParams.get('pipeline_id') || searchParams.get('pipeline') || '').trim();
    if (!pipeline_id)
      return NextResponse.json({ ok: false, error: 'pipeline_id required' }, { status: 400 });

    // пробуємо кілька відомих маршрутів KeyCRM
    const candidates = [
      `${API}/pipelines/${encodeURIComponent(pipeline_id)}/statuses?per_page=200`,
      `${API}/statuses?pipeline_id=${encodeURIComponent(pipeline_id)}&per_page=200`,
      `${API}/lead-statuses?pipeline_id=${encodeURIComponent(pipeline_id)}&per_page=200`,
    ];

    for (const u of candidates) {
      const items = await hit(u);
      if (items && items.length) {
        return NextResponse.json({ ok: true, items });
      }
    }

    return NextResponse.json({ ok: true, items: [] }); // порожньо, але без падіння
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'unexpected error' }, { status: 500 });
  }
}
