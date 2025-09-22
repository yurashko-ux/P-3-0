// web/lib/keycrm.ts
/**
 * Minimal KeyCRM client: mock-first, real calls за ENABLE_REAL_KC=true.
 * Дає стабільні іменовані експорти, які очікують існуючі маршрути.
 */

const ENABLE_REAL = process.env.ENABLE_REAL_KC === 'true';
const API_URL = process.env.KEYCRM_API_URL || '';
const API_TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || '';

type Idish = number | string;

type Card = {
  id: number;
  title: string;
  pipeline_id?: number;
  status_id?: number;
  username?: string;
};

type SearchResult = { cards: Card[] };
type MoveInput = { card_id: number; pipeline_id: Idish; status_id: Idish };

async function realFetch(path: string, init?: RequestInit) {
  if (!API_URL || !API_TOKEN)
    throw new Error('KeyCRM real mode requires KEYCRM_API_URL and KEYCRM_API_TOKEN');
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${API_TOKEN}`);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`KeyCRM ${path} ${res.status}: ${body}`);
  }
  return res.json();
}

/* -------------------- базові методи -------------------- */

export async function findByUsername(username: string): Promise<SearchResult> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/cards/search?username=${encodeURIComponent(username)}`);
    return data as SearchResult;
  }
  return { cards: [] };
}

export async function searchByTitleContains(query: string): Promise<SearchResult> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/cards/search?title=${encodeURIComponent(query)}`);
    return data as SearchResult;
  }
  return { cards: [] };
}

export async function moveCard(input: MoveInput): Promise<{ ok: true }> {
  const payload = {
    pipeline_id: Number(input.pipeline_id),
    status_id: Number(input.status_id),
  };
  if (ENABLE_REAL) {
    await realFetch(`/cards/${input.card_id}/move`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { ok: true };
  }
  return { ok: true };
}

export async function getPipelines(): Promise<Array<{ id: number; name: string }>> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/pipelines`);
    return data as Array<{ id: number; name: string }>;
  }
  return [{ id: 1, name: 'Default' }];
}

export async function getStatuses(pipeline_id: number): Promise<Array<{ id: number; name: string }>> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/pipelines/${pipeline_id}/statuses`);
    return data as Array<{ id: number; name: string }>;
  }
  return [{ id: 38, name: 'New' }];
}

export async function getCardById(id: number): Promise<Card | null> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/cards/${id}`);
    return data as Card;
  }
  return null;
}

/* -------------------- сумісні обгортки для існуючих роутів -------------------- */

/**
 * kcFindCardIdByAny:
 *  - приймає username / title / fullname та додаткові поля (pipeline_id, status_id, per_page, max_pages, ...).
 *  - пробує username, інакше шукає за title/fullname (contains).
 *  - повертає перший знайдений card.id або null.
 */
export async function kcFindCardIdByAny(input: {
  username?: string;
  title?: string;
  fullname?: string;
  pipeline_id?: Idish;
  status_id?: Idish;
  per_page?: number;
  max_pages?: number;
} & Record<string, any>): Promise<number | null> {
  const username = input?.username?.trim();
  const title = input?.title?.trim() || input?.fullname?.trim();

  if (username) {
    const res = await findByUsername(username);
    if (res.cards[0]?.id) return res.cards[0].id;
  }
  if (title) {
    const res = await searchByTitleContains(title);
    if (res.cards[0]?.id) return res.cards[0].id;
  }
  return null;
}

/**
 * kcMoveCard:
 *  - підтримує 2 сигнатури:
 *    1) kcMoveCard(card_id, pipeline_id, status_id)
 *    2) kcMoveCard({ id, pipeline_id, status_id })
 */
export async function kcMoveCard(
  arg1: number | { id: Idish; pipeline_id: Idish; status_id: Idish },
  pipeline_id?: Idish,
  status_id?: Idish
): Promise<{ ok: true }> {
  let card_id: number;
  let p: Idish;
  let s: Idish;

  if (typeof arg1 === 'number') {
    card_id = arg1;
    p = pipeline_id as Idish;
    s = status_id as Idish;
  } else {
    card_id = Number(arg1.id);
    p = arg1.pipeline_id;
    s = arg1.status_id;
  }

  return moveCard({ card_id, pipeline_id: p, status_id: s });
}

/* -------------------- default export (для старих імпортів) -------------------- */
const keycrm = {
  findByUsername,
  searchByTitleContains,
  moveCard,
  getPipelines,
  getStatuses,
  getCardById,
  kcFindCardIdByAny,
  kcMoveCard,
};
export default keycrm;

// Явні ре-експорти (на випадок tree-shaking/типових конфліктів)
export { kcFindCardIdByAny as _kcFindCardIdByAny, kcMoveCard as _kcMoveCard };
