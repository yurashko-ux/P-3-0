// web/lib/keycrm.ts
// Утіліти для KeyCRM + пошук картки за instagram username у contact.social_id

const BASE_URL = (process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1').replace(/\/+$/, '');
const API_TOKEN = process.env.KEYCRM_API_TOKEN || '';

type Json = any;

export function keycrmOk(): boolean {
  return Boolean(BASE_URL && API_TOKEN);
}

async function keycrmFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!keycrmOk()) {
    throw new Error('keycrm not configured');
  }
  const url = `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    // важливо: без кешу
    cache: 'no-store',
  });
  return r;
}

// ---- Move card ----
export async function keycrmMoveCard(card_id: string | number, to_pipeline_id: string | number, to_status_id: string | number) {
  const url = `/pipelines/cards/${encodeURIComponent(String(card_id))}`;
  const body = JSON.stringify({
    pipeline_id: Number(to_pipeline_id),
    status_id: Number(to_status_id),
  });
  const r = await keycrmFetch(url, { method: 'PUT', body });
  return { via: 'PUT pipelines/cards/{id}', status: r.status };
}

// ---- Helpers для списків ----
function coerceArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  return [];
}

function extractListItems(j: Json): any[] {
  // KeyCRM часто повертає пагінацію у різних обгортках.
  // Пробуємо найтиповіші варіанти.
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

async function listCardIdsPage(page = 1, per_page = 50, search?: string): Promise<number[]> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('per_page', String(per_page));
  // Якщо пошук підтримується бекендом — спробуємо звузити вибірку
  if (search) params.set('search', search);
  const r = await keycrmFetch(`/pipelines/cards?${params.toString()}`);
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  const items = extractListItems(j);
  return pickIds(items);
}

async function getCardDetail(cardId: number): Promise<Json | null> {
  const r = await keycrmFetch(`/pipelines/cards/${cardId}`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j;
}

// ---- Пошук картки за instagram username ----
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
    // 1) Спочатку пробуємо звузити пошуком (якщо бекенд індексує title/контакт)
    let checked = 0;
    let candidateIds = await listCardIdsPage(1, 50, username);
    if (candidateIds.length > 0) {
      for (const id of candidateIds) {
        const d = await getCardDetail(id);
        checked++;
        const social = (d as any)?.contact?.social_id || (d as any)?.contact?.socialId;
        if (social && String(social).toLowerCase() === username.toLowerCase()) {
          return { ok: true, username, card_id: id, strategy: 'search+detail', checked, scope: 'search' };
        }
      }
    }

    // 2) Якщо не знайшли — робимо обмежений глобальний скан першими сторінками
    // Щоб не вдаритись у ліміти: до 6 сторінок * 50 = 300 карток максимум.
    const MAX_PAGES = 6;
    checked = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const ids = await listCardIdsPage(page, 50);
      if (ids.length === 0) break;
      for (const id of ids) {
        const d = await getCardDetail(id);
        checked++;
        const social = (d as any)?.contact?.social_id || (d as any)?.contact?.socialId;
        if (social && String(social).toLowerCase() === username.toLowerCase()) {
          return { ok: true, username, card_id: id, strategy: 'detail-scan', checked, scope: 'global' };
        }
      }
      // Якщо остання сторінка неповна — далі нічого немає
      if (ids.length < 50) break;
    }

    return { ok: false, username, card_id: null, strategy: 'not-found', checked: 0, scope: 'global' };
  } catch (e: any) {
    return {
      ok: false,
      username,
      card_id: null,
      strategy: 'error',
      checked: 0,
      scope: 'global',
      error: e?.message || 'failed',
    };
  }
}
