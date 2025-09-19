// web/app/api/keycrm/sync/pair/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvSet, kvZAdd } from '@/lib/kv';
import { assertAdmin } from '@/lib/auth';
import { kcListCardsLaravel } from '@/lib/keycrm';

// KV keys
const KC_CARD_KEY = (id: number | string) => `kc:card:${id}`;
const KC_INDEX_PAIR = (p: number, s: number) => `kc:index:cards:${p}:${s}`;
const KC_INDEX_IG = (handle: string) => `kc:index:social:instagram:${handle}`;

// auth: Bearer ADMIN_PASS або ?pass=ADMIN_PASS
async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if ((expected && bearer === expected) || (expected && passParam === expected)) return true;
  try { await assertAdmin(req); return true; } catch { return false; }
}

function normHandle(s?: string | null) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.replace(/^@+/, '').toLowerCase();
}

function normalizeCard(raw: any) {
  const pipelineId = raw?.status?.pipeline_id ?? raw?.pipeline_id ?? null;
  const statusId   = raw?.status_id ?? raw?.status?.id ?? null;
  const socialName = String(raw?.contact?.social_name ?? '').toLowerCase() || null;
  const socialId   = raw?.contact?.social_id ?? null;
  const fullName   = raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? null;
  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? '').trim(),
    pipeline_id: pipelineId ? Number(pipelineId) : null,
    status_id: statusId ? Number(statusId) : null,
    contact_social_name: socialName,
    contact_social_id: socialId,
    contact_full_name: fullName ?? null,
    updated_at: String(raw?.updated_at ?? raw?.status_changed_at ?? new Date().toISOString()),
  } as const;
}

async function indexCard(card: ReturnType<typeof normalizeCard>) {
  const score = Date.parse(card.updated_at) || Date.now();
  await kvSet(KC_CARD_KEY(card.id), card);
  if (card.pipeline_id && card.status_id) {
    await kvZAdd(KC_INDEX_PAIR(card.pipeline_id, card.status_id), score, String(card.id));
  }
  const h = normHandle(card.contact_social_id);
  if (h) {
    await kvZAdd(KC_INDEX_IG(h), score, String(card.id));
    await kvZAdd(KC_INDEX_IG(`@${h}`), score, String(card.id));
  }
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized. Use Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>' },
        { status: 401 },
      );
    }

    const url = new URL(req.url);
    // ❗️Приводимо до number одразу тут
    const p = Number(url.searchParams.get('pipeline_id') ?? '');
    const s = Number(url.searchParams.get('status_id') ?? '');
    const per_page = Number(url.searchParams.get('per_page') ?? '50') || 50;
    const max_pages = Number(url.searchParams.get('max_pages') ?? '2') || 2;
    const path = (url.searchParams.get('path') || 'leads').replace(/^\/+/, '');

    if (!Number.isFinite(p) || !Number.isFinite(s)) {
      return NextResponse.json(
        { ok: false, error: 'pipeline_id and status_id are required numbers' },
        { status: 400 },
      );
    }

    let page = 1;
    let fetched = 0;
    let indexed = 0;
    const preview: any[] = [];

    // Проста пагінація до max_pages; kcListCardsLaravel -> leads під капотом
    while (page <= max_pages) {
      const { items, hasNext } = await kcListCardsLaravel({
        page,
        per_page,
        pipeline_id: p, // тепер це number
        status_id: s,   // тепер це number
        path,           // 'leads' за замовчуванням
      });

      // локальна фільтрація на випадок, якщо API не фільтрує
      const filtered = items.filter((raw: any) => {
        const pp = raw?.status?.pipeline_id ?? raw?.pipeline_id;
        const ss = raw?.status_id ?? raw?.status?.id;
        return Number(pp) === p && Number(ss) === s;
      });

      for (const raw of filtered) {
        const card = normalizeCard(raw);
        await indexCard(card);
        indexed += 1;
        if (preview.length < 5) {
          preview.push({ id: card.id, title: card.title, social: card.contact_social_id });
        }
      }
      fetched += filtered.length;

      if (!hasNext) break;
      page += 1;
    }

    return NextResponse.json({
      ok: true,
      path,
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
      {
        ok: false,
        error: e?.message || String(e),
        hint: 'Передай ?pipeline_id=<number>&status_id=<number>&per_page=50&max_pages=2&path=leads',
      },
      { status: 400 },
    );
  }
}
