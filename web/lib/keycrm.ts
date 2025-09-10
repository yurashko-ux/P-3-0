// web/lib/keycrm.ts
/**
 * Легкий клієнт для KeyCRM.
 * Потрібні змінні середовища:
 *  - KEYCRM_API_TOKEN (Bearer токен)
 *  - KEYCRM_BASE_URL  (опційно, за замовч. https://openapi.keycrm.app/v1)
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
  return fetch(url, init);
}

// ---- Пошук картки за title (instagram username_id) ----
export async function kcFindCardIdByTitle(title: string): Promise<number | null> {
  if (!title) return null;

  // Спробуємо кілька відомих варіантів ендпоінтів фільтрації/пошуку
  const candidates = [
    `${KC_BASE}/cards?title=${encodeURIComponent(title)}`,
    `${KC_BASE}/cards?search=${encodeURIComponent(title)}`,
    `${KC_BASE}/cards?query[title]=${encodeURIComponent(title)}`,
    `${KC_BASE}/pipelines/cards?title=${encodeURIComponent(title)}`,
  ];

  for (const url of candidates) {
    try {
      const r = await kcFetch(url, { headers: kcHeaders(false), cache: 'no-store' });
      if (!r.ok) continue;
      const j: any = await r.json().catch(() => null);

      const items = Array.isArray(j) ? j
        : Array.isArray(j?.data) ? j.data
        : Array.isArray(j?.items) ? j.items
        : [];

      const match = items.find((c: any) => (c?.title ?? c?.name) === title);
      if (match?.id != null) return Number(match.id);
    } catch {}
  }
  return null;
}

// ---- Рух картки між статусами (ми вже використовували PUT pipelines/cards/{id}) ----
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

