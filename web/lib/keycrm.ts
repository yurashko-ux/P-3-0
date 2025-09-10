// web/lib/keycrm.ts
/**
 * Легкий клієнт для KeyCRM.
 * ENV:
 *  - KEYCRM_API_TOKEN (Bearer токен) — обов'язково
 *  - KEYCRM_BASE_URL  — опційно, за замовч. https://openapi.keycrm.app/v1
 */

const KC_BASE = (process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1').replace(/\/+$/, '');
const KC_TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || '';

function kcHeaders(json = true) {
  const h: Record<string, string> = { Authorization: `Bearer ${KC_TOKEN}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function kcFetch(url: string, init?: RequestInit) {
  if (!KC_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'KEYCRM_API_TOKEN not set' }), { status: 500 });
  }
  return fetch(url, { cache: 'no-store', ...init });
}

/**
 * Пошук картки за title (instagram username_id).
 * Пробує кілька варіантів ендпоінтів/параметрів, повертає перший знайдений id.
 */
export async function kcFindCardIdByTitle(title: string): Promise<number | null> {
  const t = String(title ?? '').trim();
  if (!t) return null;

  const candidates = [
    `${KC_BASE}/cards?title=${encodeURIComponent(t)}`,
    `${KC_BASE}/cards?search=${encodeURIComponent(t)}`,
    `${KC_BASE}/cards?query[title]=${encodeURIComponent(t)}`,
    `${KC_BASE}/pipelines/cards?title=${encodeURIComponent(t)}`,
  ];

  for (const url of candidates) {
    try {
      const r = await kcFetch(url, { headers: kcHeaders(false) });
      if (!r.ok) continue;
      const j: any = await r.json().catch(() => null);

      const items =
        Array.isArray(j) ? j :
        Array.isArray(j?.data) ? j.data :
        Array.isArray(j?.items) ? j.items :
        [];

      // пріоритезуємо точний збіг по title
      const exact = items.find((c: any) =>
        String(c?.title ?? c?.name ?? '').trim().toLowerCase() === t.toLowerCase()
      );
      if (exact?.id != null) return Number(exact.id);

      // fallback — перший елемент із id
      const first = items.find((c: any) => c?.id != null);
      if (first?.id != null) return Number(first.id);
    } catch {}
  }

  return null;
}

/**
 * АЛІАС для існуючого імпорту в роуті:
 *  findCardIdByUsername(username) → шукає card.id по title === username
 */
export async function findCardIdByUsername(username: string): Promise<number | null> {
  return kcFindCardIdByTitle(username);
}

/**
 * Рух картки між статусами/воронками.
 * Використовує PUT /pipelines/cards/{cardId}
 * body може містити: { status_id?, pipeline_id?, ...інші поля KeyCRM }
 */
export async function kcMoveCard(cardId: number | string, body: any) {
  const url = `${KC_BASE}/pipelines/cards/${encodeURIComponent(String(cardId))}`;
  const r = await kcFetch(url, {
    method: 'PUT',
    headers: kcHeaders(true),
    body: JSON.stringify(body),
  });
  const ok = r.ok;
  let json: any = null;
  try { json = await r.json(); } catch {}
  return { ok, status: r.status, response: json, via: 'PUT pipelines/cards/{id}' };
}
