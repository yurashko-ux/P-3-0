// web/lib/keycrm.ts
/**
 * Minimal KeyCRM client: mock-first, real calls behind ENABLE_REAL_KC=true.
 * Safe wrappers for build-time stability; extend to real API later.
 */
const ENABLE_REAL = process.env.ENABLE_REAL_KC === 'true';
const API_URL = process.env.KEYCRM_API_URL || '';
const API_TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || '';

type Card = { id: number; title: string; pipeline_id?: number; status_id?: number; username?: string };
type SearchResult = { cards: Card[] };
type MoveInput = { card_id: number; pipeline_id: number; status_id: number };

async function realFetch(path: string, init?: RequestInit) {
  if (!API_URL || !API_TOKEN) throw new Error('KeyCRM real mode requires KEYCRM_API_URL and KEYCRM_API_TOKEN');
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

/** Find cards by Instagram username */
export async function findByUsername(username: string): Promise<SearchResult> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/cards/search?username=${encodeURIComponent(username)}`);
    return data as SearchResult;
  }
  return { cards: [] };
}

/** Generic search by title substring (used for V1/V2 rules). */
export async function searchByTitleContains(query: string): Promise<SearchResult> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/cards/search?title=${encodeURIComponent(query)}`);
    return data as SearchResult;
  }
  return { cards: [] };
}

/** Move a card to another pipeline/status. */
export async function moveCard(input: MoveInput): Promise<{ ok: true }> {
  if (ENABLE_REAL) {
    await realFetch(`/cards/${input.card_id}/move`, {
      method: 'POST',
      body: JSON.stringify({ pipeline_id: input.pipeline_id, status_id: input.status_id }),
    });
    return { ok: true };
  }
  return { ok: true };
}

/** Fetch pipelines list (id/name) */
export async function getPipelines(): Promise<Array<{ id: number; name: string }>> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/pipelines`);
    return data as Array<{ id: number; name: string }>;
  }
  return [{ id: 1, name: 'Default' }];
}

/** Fetch statuses list for a pipeline */
export async function getStatuses(pipeline_id: number): Promise<Array<{ id: number; name: string }>> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/pipelines/${pipeline_id}/statuses`);
    return data as Array<{ id: number; name: string }>;
  }
  return [{ id: 38, name: 'New' }];
}

/** Convenience: get card by exact id */
export async function getCardById(id: number): Promise<Card | null> {
  if (ENABLE_REAL) {
    const data = await realFetch(`/cards/${id}`);
    return data as Card;
  }
  return null;
}

/* ------------------------------------------------------------------
 * Compatibility wrappers used by existing routes
 * ------------------------------------------------------------------ */

/**
 * kcFindCardIdByAny: tries username first (if provided), else uses title/fullname contains.
 * Accepts extra fields (pipeline_id/status_id/per_page/...) and safely ignores them in mock mode.
 */
export async function kcFindCardIdByAny(input: {
  username?: string;
  title?: string;
  fullname?: string;
  pipeline_id?: number;
  status_id?: number;
  per_page?: number;
  // allow future extra fields without TS error
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

/** kcMoveCard: thin wrapper to satisfy named import usage. */
export async function kcMoveCard(card_id: number, pipeline_id: number, status_id: number): Promise<{ ok: true }> {
  return moveCard({ card_id, pipeline_id, status_id });
}

/** Default export for modules importing the client as default. */
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
