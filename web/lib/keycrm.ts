// web/lib/keycrm.ts
// KeyCRM utils: пошук картки за IG username (contact.social_id) + пошук по title («Чат з …») + move

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
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  return r;
}

const norm = (s: string) => (s || '').trim().replace(/^@+/, '').toLowerCase();
const normTitle = (s: string) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

function extractListItems(j: Json): any[] {
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.items)) return j.items;
  if (Array.isArray(j?.result)) return j.result;
  if (Array.isArray(j?.data?.items)) return j.data.items;
  return [];
}

function itemId(it: any): number | null {
  const n = Number(it?.id ?? it?.card_id ?? it?.cardId);
  return Number.isFinite(n) ? n : null;
}

type Style = 'jsonapi' | 'laravel';
type ListOpts = {
  page: number;
  per: number;
  search?: string;
  pipeline_id?: string;
  withContact?: boolean;
};

async function listCardsPage(style: Style, opts: ListOpts): Promise<{ items: any[]; count: number }> {
  const q = new URLSearchParams();
  if (style === 'jsonapi') {
    q.set('page[number]', String(opts.page));
    q.set('page[size]', String(opts.per));
  } else {
    q.set('page', String(opts.page));
    q.set('per_page', String(opts.per));
  }
  if (opts.search) q.set('search', opts.search);
  if (opts.pipeline_id) q.set('pipeline_id', opts.pipeline_id);
  if (opts.withContact) q.set('with', 'contact');

  const r = await keycrmFetch(`/pipelines/cards?${q.toString()}`);
  if (!r.ok) return { items: [], count: 0 };
  const j = await r.json().catch(() => ({}));
  const items = extractListItems(j);
  return { items, count: Array.isArray(items) ? items.length : 0 };
}

async function getCardDetail(cardId: number): Promise<Json | null> {
  const r = await keycrmFetch(`/pipelines/cards/${cardId}`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const d = (j as any)?.data ?? j ?? null;
  return d;
}

/* -------------------- СТАН + MOVE -------------------- */

export async function kcGetCardState(cardId: string | number): Promise<{ pipeline_id: string; status_id: string } | null> {
  const r = await keycrmFetch(`/pipelines/cards/${encodeURIComponent(String(cardId))}`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const d = (j as any)?.data ?? j ?? null;
  if (!d) return null;
  return { pipeline_id: String(d.pipeline_id ?? ''), status_id: String(d.status_id ?? '') };
}

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

// для сумісності зі старими імпортами
export { keycrmMoveCard as kcMoveCard };

/* -------------------- ПОШУК ЗА IG USERNAME -------------------- */

export type FindResult = {
  ok: boolean;
  username: string;
  card_id: number | null;
  strategy: 'search-with-contact' | 'search+detail' | 'detail-scan' | 'not-found' | 'error';
  checked: number;
  scope: 'search' | 'global';
  error?: string;
};

export async function findCardIdByUsername(usernameRaw: string, pipelineId?: string): Promise<FindResult> {
  const username = String(usernameRaw || '').trim();
  if (!username) {
    return { ok: false, username, card_id: null, strategy: 'not-found', checked: 0, scope: 'global' };
  }
  const target = norm(username);

  try {
    // 1) search + with=contact
    for (const style of ['jsonapi', 'laravel'] as Style[]) {
      let checked = 0;
      for (let page = 1; page <= 25; page++) {
        const { items, count } = await listCardsPage(style, {
          page, per: 100, search: username, pipeline_id: pipelineId, withContact: true,
        });
        if (count === 0) break;

        for (const it of items) {
          const id = itemId(it);
          const listed = norm(String(it?.contact?.social_id ?? it?.contact?.socialId ?? ''));
          if (id && listed && listed === target) {
            return { ok: true, username, card_id: id, strategy: 'search-with-contact', checked, scope: 'search' };
          }
        }

        for (const it of items) {
          if (checked >= 300) break;
          if (it?.contact) continue;
          const id = itemId(it);
          if (!id) continue;
          const d = await getCardDetail(id);
          checked++;
          const social = norm(String(d?.contact?.social_id ?? d?.contact?.socialId ?? ''));
          if (social && social === target) {
            return { ok: true, username, card_id: id, strategy: 'search+detail', checked, scope: 'search' };
          }
        }

        if (count < 100) break;
      }
    }

    // 2) глобальний скан
    for (const style of ['jsonapi', 'laravel'] as Style[]) {
      let checked = 0;
      for (let page = 1; page <= 40; page++) {
        const { items, count } = await listCardsPage(style, {
          page, per: 100, pipeline_id: pipelineId, withContact: true,
        });
        if (count === 0) break;

        for (const it of items) {
          const id = itemId(it);
          const listed = norm(String(it?.contact?.social_id ?? it?.contact?.socialId ?? ''));
          if (id && listed && listed === target) {
            return { ok: true, username, card_id: id, strategy: 'detail-scan', checked, scope: 'global' };
          }
        }

        for (const it of items) {
          if (checked >= 1000) break;
          if (it?.contact) continue;
          const id = itemId(it);
          if (!id) continue;
          const d = await getCardDetail(id);
          checked++;
          const social = norm(String(d?.contact?.social_id ?? d?.contact?.socialId ?? ''));
          if (social && social === target) {
            return { ok: true, username, card_id: id, strategy: 'detail-scan', checked, scope: 'global' };
          }
        }

        if (count < 100) break;
      }
    }

    return { ok: false, username, card_id: null, strategy: 'not-found', checked: 0, scope: 'global' };
  } catch (e: any) {
    return { ok: false, username, card_id: null, strategy: 'error', checked: 0, scope: 'global', error: e?.message || 'failed' };
  }
}

/* -------------------- ПОШУК ЗА TITLE (FULL NAME) -------------------- */

export async function kcFindCardIdByTitleSmart(fullnameRaw: string, pipelineId?: string): Promise<{ ok: boolean; card_id: number | null; strategy: string; checked: number; }> {
  const fullname = (fullnameRaw || '').trim();
  if (!fullname) return { ok: false, card_id: null, strategy: 'no-fullname', checked: 0 };

  const target = normTitle(fullname);
  const targetExact = `чат з ${target}`; // очікуваний формат заголовка

  // 1) Пошук через search (якщо індексує title)
  for (const style of ['jsonapi', 'laravel'] as Style[]) {
    let checked = 0;
    for (let page = 1; page <= 25; page++) {
      const { items, count } = await listCardsPage(style, {
        page, per: 100, search: fullname, pipeline_id: pipelineId,
      });
      if (count === 0) break;

      for (const it of items) {
        const id = itemId(it);
        const title = normTitle(String(it?.title ?? ''));
        if (!id) continue;
        if (title === targetExact || title.endsWith(` ${target}`) || title.includes(target)) {
          return { ok: true, card_id: id, strategy: 'title-search', checked };
        }
      }
      if (count < 100) break;
    }
  }

  // 2) Глобальний скан по title
  for (const style of ['jsonapi', 'laravel'] as Style[]) {
    let checked = 0;
    for (let page = 1; page <= 40; page++) {
      const { items, count } = await listCardsPage(style, {
        page, per: 100, pipeline_id: pipelineId,
      });
      if (count === 0) break;

      for (const it of items) {
        const id = itemId(it);
        const title = normTitle(String(it?.title ?? ''));
        if (!id) continue;
        if (title === targetExact || title.endsWith(` ${target}`) || title.includes(target)) {
          return { ok: true, card_id: id, strategy: 'title-scan', checked };
        }
      }
      if (count < 100) break;
    }
  }

  return { ok: false, card_id: null, strategy: 'title-not-found', checked: 0 };
}
