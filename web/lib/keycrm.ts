// web/lib/keycrm.ts
// KeyCRM utils: пошук картки за IG username (contact.social_id) + стан + move

const BASE_URL = (process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1').replace(/\/+$/, '');
const API_TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || '';

type Json = any;

export function keycrmOk(): boolean {
  return Boolean(BASE_URL && API_TOKEN);
}

async function keycrmFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!keycrmOk()) throw new Error('keycrm not configured');
  const url = `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  return r;
}

function extractListItems(j: Json): any[] {
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.items)) return j.items;
  if (Array.isArray(j?.result)) return j.result;
  if (Array.isArray(j?.data?.items)) return j.data.items;
  return [];
}

function pickIds(items: any[]): number[] {
  const out: number[] = [];
  for (const it of items) {
    if (it == null) continue;
    if (typeof it === 'number') { out.push(it); continue; }
    const id = Number((it && (it.id ?? it.card_id ?? it.cardId)));
    if (Number.isFinite(id)) out.push(id);
  }
  return out;
}

async function listCardIdsPage(page = 1, per = 100, search?: string): Promise<number[]> {
  // 1) JSON:API стиль: page[number] / page[size]
  const p1 = new URLSearchParams();
  p1.set('page[number]', String(page));
  p1.set('page[size]', String(per));
  if (search) p1.set('search', search);
  let r = await keycrmFetch(`/pipelines/cards?${p1.toString()}`);
  if (r.ok) {
    const j = await r.json().catch(() => ({}));
    const items = extractListItems(j);
    const ids = pickIds(items);
    if (ids.length) return ids;
  }

  // 2) Ларавел-стиль: page / per_page
  const p2 = new URLSearchParams();
  p2.set('page', String(page));
  p2.set('per_page', String(per));
  if (search) p2.set('search', search);
  r = await keycrmFetch(`/pipelines/cards?${p2.toString()}`);
  if (!r.ok) return [];
  const j2 = await r.json().catch(() => ({}));
  const items2 = extractListItems(j2);
  return pickIds(items2);
}

async function getCardDetail(cardId: number): Promise<Json | null> {
  const r = await keycrmFetch(`/pipelines/cards/${cardId}`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j;
}

const norm = (s: string) => (s || '').trim().replace(/^@+/, '').toLowerCase();

/** Головний пошук: знаходимо картку, де contact.social_id === username */
export type FindResult = {
  ok: boolean;
  username: string;
  card_id: number | null;
  strategy: 'search+detail' | 'detail-scan' | 'not-found' | 'error';
  checked: number;
  scope: 'search' | 'global';
  error?: string;
};

export async function findCardIdByUsername(usernameRaw: string): Promise<FindResult> {
  const username = String(usernameRaw || '').trim();
  if (!username) {
    return { ok: false, username, card_id: null, strategy: 'not-found', checked: 0, scope: 'global' };
  }

  try {
    // 1) Звузити пошуком: спершу сторінка з пошуком (100 штук)
    let checked = 0;
    const firstIds = await listCardIdsPage(1, 100, username);
    for (const id of firstIds) {
      const d = await getCardDetail(id);
      checked++;
      const social = (d as any)?.contact?.social_id || (d as any)?.contact?.socialId;
      if (social && norm(String(social)) === norm(username)) {
        return { ok: true, username, card_id: id, strategy: 'search+detail', checked, scope: 'search' };
      }
    }

    // 2) Обмежений глобальний скан — до 20 сторінок * 100 = 2000 карток
    checked = 0;
    const MAX_PAGES = 20;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const ids = await listCardIdsPage(page, 100);
      if (ids.length === 0) break;
      for (const id of ids) {
        const d = await getCardDetail(id);
        checked++;
        const social = (d as any)?.contact?.social_id || (d as any)?.contact?.socialId;
        if (social && norm(String(social)) === norm(username)) {
          return { ok: true, username, card_id: id, strategy: 'detail-scan', checked, scope: 'global' };
        }
      }
      if (ids.length < 100) break; // кінець списку
    }

    return { ok: false, username, card_id: null, strategy: 'not-found', checked: 0, scope: 'global' };
  } catch (e: any) {
    return { ok: false, username, card_id: null, strategy: 'error', checked: 0, scope: 'global', error: e?.message || 'failed' };
  }
}

// ---- Стан картки (для базового матчу кампанії) ----
export async function kcGetCardState(cardId: string | number): Promise<{ pipeline_id: string; status_id: string } | null> {
  const r = await keycrmFetch(`/pipelines/cards/${encodeURIComponent(String(cardId))}`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const d = (j as any)?.data ?? j ?? null;
  if (!d) return null;
  return { pipeline_id: String(d.pipeline_id ?? ''), status_id: String(d.status_id ?? '') };
}

// ---- Move card ----
export async function keycrmMoveCard(
  card_id: string | number,
  to_pipeline_id?: string | number,
  to_status_id?: string | number,
  note?: string
) {
  const body: any = {};
  if (to_pipeline_id != null) body.pipeline_id = Number(to_pipeline_id);
  if (to_status_id != null) body.status_id = Number(to_status_id);
  if (note) body.note = note;

  const r = await keycrmFetch(`/pipelines/cards/${encodeURIComponent(String(card_id))}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  let resp: any = undefined; try { resp = await r.clone().json(); } catch {}
  return { ok: r.ok, status: r.status, response: resp, via: 'PUT pipelines/cards/{id}' };
}

// ---- Експорти сумісності
export { keycrmMoveCard as kcMoveCard };
