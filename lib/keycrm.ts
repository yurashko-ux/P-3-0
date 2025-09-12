// lib/keycrm.ts
// Мінімальний адаптер до KeyCRM + стаби для відсутніх експортів,
// щоб зняти помилку "kcGetCardState is not exported from '@/lib/keycrm'".

type NumStr = number | string;

const KC_BASE = process.env.KEYCRM_BASE_URL?.replace(/\/+$/, '') || 'https://openapi.keycrm.app/v1';
const KC_TOKEN = process.env.KEYCRM_API_TOKEN || '';

function assertToken() {
  if (!KC_TOKEN) throw new Error('KEYCRM_API_TOKEN is not set');
}

async function kcFetch(path: string, init?: RequestInit) {
  assertToken();
  const url = `${KC_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KC_TOKEN}`,
      ...(init?.headers || {}),
    },
    // Важливо для Vercel Edge/Node: не кешуємо відповіді KeyCRM
    cache: 'no-store',
  });
  return res;
}

/** Сумісно з "Laravel style" пагінацією в KeyCRM */
export async function kcListCardsLaravel(params: {
  pipeline_id: NumStr;
  status_id: NumStr;
  page?: number;
  per_page?: number;
}) {
  const { pipeline_id, status_id, page = 1, per_page = 50 } = params;
  const qs = new URLSearchParams({
    pipeline_id: String(pipeline_id),
    status_id: String(status_id),
    page: String(page),
    per_page: String(per_page),
  });
  const res = await kcFetch(`/pipelines/cards?${qs.toString()}`, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KeyCRM list cards failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<{
    total?: number;
    current_page?: number;
    last_page?: number;
    per_page?: number;
    data?: any[];
    // іноді ще буває meta/links, ігноруємо
  }>;
}

/** Рух картки між pipeline/status */
export async function kcMoveCard(
  cardId: NumStr,
  opts: { to_pipeline_id?: NumStr; to_status_id?: NumStr }
): Promise<{ ok: boolean; status: number; body?: any }> {
  const body: Record<string, any> = {};
  if (opts.to_pipeline_id != null) body.pipeline_id = Number(opts.to_pipeline_id);
  if (opts.to_status_id != null) body.status_id = Number(opts.to_status_id);

  const res = await kcFetch(`/pipelines/cards/${cardId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* ignore non-JSON */
  }
  return { ok: res.ok, status: res.status, body: json };
}

/**
 * ✅ СТАБ для відсутнього експорту.
 * Повертає "state=null", щоб не ламати білд. Реальну реалізацію підʼєднаємо пізніше.
 */
export async function kcGetCardState(cardId: NumStr): Promise<{
  ok: boolean;
  state: null | {
    id: number;
    pipeline_id: number | null;
    status_id: number | null;
    title?: string;
    updated_at?: string;
  };
  note?: string;
}> {
  // Стаб: нічого не чіпаємо в KeyCRM, просто повертаємо "не знайдено".
  // Якщо потрібно, можемо читати локальний KV кеш (kc:card:{id}),
  // але це опціонально і не потрібне для проходження збірки.
  return { ok: true, state: null, note: 'stub kcGetCardState (no-op)' };
}

/**
 * ✅ Безпечний СТАБ пошуку. Повертає "card_id=null".
 * Реальний пошук по KV-індексах додамо окремо.
 */
export async function kcFindCardIdByAny(_params: {
  username?: string;
  fullname?: string;
  pipeline_id: NumStr;
  status_id: NumStr;
  limit?: number;
}): Promise<{ ok: boolean; card_id: number | null; via: 'stub' }> {
  return { ok: true, card_id: null, via: 'stub' };
}
