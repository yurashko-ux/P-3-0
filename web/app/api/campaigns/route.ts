// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';

type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
type Campaign = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: BaseInfo;
  counters?: Counters;
};

// універсальний “розпаковувач”
function unwrapDeep<T = any>(v: any): T {
  if (v == null) return v;
  let cur = v;
  // тягнемо .value поки є
  while (cur && typeof cur === 'object' && 'value' in cur) cur = (cur as any).value;
  // якщо це JSON-рядок – парсимо
  if (typeof cur === 'string') {
    const s = cur.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try { return JSON.parse(s); } catch { /* ignore */ }
    }
  }
  return cur as T;
}

export async function GET() {
  try {
    // TODO: тут ваша логіка отримання “сирих” кампаній
    // const raw: any[] = await loadFromKVorAPI();

    const raw: any[] = []; // заглушка, щоб не падало, замініть на ваші дані

    const items: Campaign[] = raw.map((r) => {
      const id = String(unwrapDeep(r.id ?? r._id ?? ''));
      const name = unwrapDeep<string>(r.name ?? '');
      const v1 = unwrapDeep<string>(r.v1 ?? '');
      const v2 = unwrapDeep<string>(r.v2 ?? '');

      const baseRaw = unwrapDeep<any>(r.base ?? {});
      const base: BaseInfo = {
        pipeline: unwrapDeep<string>(baseRaw?.pipeline ?? ''),
        status: unwrapDeep<string>(baseRaw?.status ?? ''),
        pipelineName: unwrapDeep<string>(baseRaw?.pipelineName ?? ''),
        statusName: unwrapDeep<string>(baseRaw?.statusName ?? ''),
      };

      const cRaw = unwrapDeep<any>(r.counters ?? {});
      const counters: Counters = {
        v1: Number(unwrapDeep(cRaw?.v1 ?? 0) || 0),
        v2: Number(unwrapDeep(cRaw?.v2 ?? 0) || 0),
        exp: Number(unwrapDeep(cRaw?.exp ?? 0) || 0),
      };

      return { id, name, v1, v2, base, counters };
    });

    return NextResponse.json({ ok: true, items, count: items.length });
  } catch (e) {
    console.error('GET /api/campaigns failed', e);
    return NextResponse.json({ ok: false, items: [], count: 0 }, { status: 500 });
  }
}
