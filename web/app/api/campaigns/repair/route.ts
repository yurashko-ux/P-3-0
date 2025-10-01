import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { unwrapDeep, normalizeId } from '@/lib/normalize';

export const runtime = 'nodejs';
const KEY = 'cmp:list:items';

/**
 * Опціональний endpoint, який:
 *  - знімає «обгортки» {value: ...}
 *  - прибирає дублі за id
 *  - видаляє null/undefined
 */
export async function POST() {
  try {
    const raw = await kv.get(KEY);
    const arr = unwrapDeep<any[]>(raw) || [];

    const seen = new Set<string>();
    const cleaned = [];
    for (const it of arr) {
      const id = normalizeId(it?.id);
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      cleaned.push({
        id,
        name: it?.name ?? '—',
        v1: it?.v1 ?? '—',
        v2: it?.v2 ?? '—',
        base: {
          pipeline: it?.base?.pipeline,
          status: it?.base?.status,
          pipelineName: it?.base?.pipelineName,
          statusName: it?.base?.statusName,
        },
        counters: {
          v1: Number(it?.counters?.v1 ?? 0),
          v2: Number(it?.counters?.v2 ?? 0),
          exp: Number(it?.counters?.exp ?? 0),
        },
        deleted: !!it?.deleted,
        createdAt: Number(it?.createdAt ?? Date.now()),
      });
    }

    await kv.set(KEY, cleaned);
    return NextResponse.json({ ok: true, repaired: cleaned.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Repair error' },
      { status: 500 }
    );
  }
}
