// web/app/api/keycrm/sync/pair/route.ts
// Синк однієї пари (pipeline_id + status_id) із KeyCRM через GET /pipelines/cards
// Індексуємо в KV: kc:card:{id}, kc:index:cards:{p}:{s}, kc:index:social:instagram:{handle}

import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvSet, kvZAdd } from '@/lib/kv';
import { kcListCards } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

const PAIR_INDEX = (p: number, s: number) => `kc:index:cards:${p}:${s}`;
const SOCIAL_INDEX = (handle: string) => `kc:index:social:instagram:${handle}`;
const CARD_KEY = (id: number | string) => `kc:card:${id}`;

function normHandle(raw?: string | null) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  return t.replace(/^@+/, '').toLowerCase();
}

function normalizeCard(raw: any) {
  const pipelineId = raw?.status?.pipeline_id ?? raw?.pipeline_id ?? null;
  const statusId = raw?.status_id ?? raw?.status?.id ?? null;
  const socialName = String(raw?.contact?.social_name ?? '').toLowerCase() || null;
  const socialId = raw?.contact?.social_id ?? null;
  const fullName =
    raw?.contact?.full_name ??
    raw?.contact?.client?.full_name ??
    null;
  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? '').trim(),
    pipeline_id: pipelineId ? Number(pipelineId) : null,
    status_id: statusId ? Number(statusId) : null,
    contact_social_name: socialName,
    contact_social_id: socialId,
    contact_full_name: fullName,
    updated_at: String(raw?.updated_at ?? raw?.status_changed_at ?? new Date().toISOString()),
  } as const;
}

export async function GET(req: NextRequest) {
  try {
    await assertAdmin(req);

    const url = new URL(req.url);
    const p = Number(url.searchParams.get('pipeline_id') || '');
    const s = Number(url.searchParams.get('status_id') || '');
    const per_page = Number(url.searchParams.get('per_page') || '50') || 50;
    const max_pages = Number(url.searchParams.get('max_pages') || '2') || 2;

    if (!Number.isFinite(p) || !Number.isFinite(s)) {
      return NextResponse.json(
        { ok: false, error: 'pipeline_id and status_id are required numbers' },
        { status: 400 }
      );
    }

    let page = 1;
    let fetched = 0;
    let indexed = 0;
    const preview: Array<{ id: number; social?: string | null; title?: string }> = [];

    const pairIndexKey = PAIR_INDEX(p, s);
    const now = Date.now();

    while (page <= max_pages) {
      const { items, hasNext } = await kcListCards({
        page,
        per_page,
        pipeline_id: p,
        status_id: s,
      });

      fetched += items.length;

      for (const raw of items) {
        const card = normalizeCard(raw);
        if (card.pipeline_id !== p || card.status_id !== s) continue;

        // зберігаємо нормалізовану картку
        await kvSet(CARD_KEY(card.id), card);

        // індекс пари
        await kvZAdd(pairIndexKey, { score: now, member: String(card.id) });

        // індекс по IG handle (і з @, і без @)
        const handle = normHandle(card.contact_social_id);
        if (handle) {
          await kvZAdd(SOCIAL_INDEX(handle), { score: now, member: String(card.id) });
          await kvZAdd(SOCIAL_INDEX('@' + handle), { score: now, member: String(card.id) });
        }

        indexed++;
        if (preview.length < 5)
          preview.push({ id: card.id, social: card.contact_social_id, title: card.title });
      }

      if (!hasNext) break;
      page += 1;
    }

    return NextResponse.json({
      ok: true,
      pipeline_id: p,
      status_id: s,
      per_page,
      max_pages,
      fetched,
      indexed,
      preview,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 400 }
    );
  }
}
