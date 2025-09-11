// lib/keycrm-search.ts
// ШВИДКИЙ ПОШУК КАРТКИ В МЕЖАХ БАЗОВОЇ ВОРОНКИ/СТАТУСУ АКТИВНОЇ КАМПАНІЇ.
// Пріоритет 1: точний збіг IG-логіну в contact.social_id
// Пріоритет 2: збіг ПІБ у title ("Чат з <Full Name>") — нечутливо до регістру/зайвих пробілів.
// Жорсткі ліміти: кількість сторінок, per_page, таймаут на весь цикл.

type KcPageMeta = { total?: number; per_page?: number; current_page?: number; last_page?: number; meta?: any };

const KC_BASE = process.env.KEYCRM_BASE_URL ?? 'https://openapi.keycrm.app/v1';
const KC_TOKEN = process.env.KEYCRM_API_TOKEN || '';

if (!KC_TOKEN) {
  // дозволяємо імпорт навіть без токена, але запити падатимуть з 401 — це ок.
  console.warn('[keycrm-search] Missing KEYCRM_API_TOKEN');
}

function kcHeaders() {
  return { Authorization: `Bearer ${KC_TOKEN}`, 'Content-Type': 'application/json' };
}

async function kcListCardsPage(params: {
  pipeline_id?: number;
  status_id?: number;
  page: number;
  perPage: number;
  signal?: AbortSignal;
}) {
  const { pipeline_id, status_id, page, perPage, signal } = params;

  // Laravel-стиль: ?page=1&per_page=50  (KeyCRM приймає саме такі параметри у /pipelines/cards)
  const qs = new URLSearchParams();
  qs.set('page', String(page));
  qs.set('per_page', String(perPage));
  if (pipeline_id) qs.set('pipeline_id', String(pipeline_id));
  if (status_id) qs.set('status_id', String(status_id));

  const url = `${KC_BASE}/pipelines/cards?${qs.toString()}`;
  const res = await fetch(url, { headers: kcHeaders(), signal });

  if (!res.ok) {
    return { ok: false as const, data: [] as any[], meta: {} as KcPageMeta, status: res.status };
  }

  const json = await res.json();
  // KeyCRM зазвичай повертає { total, per_page, current_page, data: [...] }
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return { ok: true as const, data, meta: json as KcPageMeta, status: res.status };
}

export async function kcFindCardIdFast(
  needle: { username?: string; fullName?: string },
  opts?: { pipeline_id?: number; status_id?: number; maxPages?: number; perPage?: number; timeoutMs?: number }
): Promise<number | null> {
  const username = needle.username?.trim();
  const fullName = needle.fullName?.trim();
  const perPage  = Math.max(1, opts?.perPage ?? 50);
  const maxPages = Math.max(1, opts?.maxPages ?? 3);

  // Жорсткий дедлайн на цикл пошуку
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(1000, opts?.timeoutMs ?? 8000));

  let page = 1;
  try {
    while (page <= maxPages) {
      const { ok, data, meta } = await kcListCardsPage({
        pipeline_id: opts?.pipeline_id,
        status_id:   opts?.status_id,
        page,
        perPage,
        signal: ac.signal,
      });
      if (!ok) break;

      for (const c of data) {
        // 1) IG-логін у contact.social_id
        const ig = c?.contact?.social_id;
        if (username && typeof ig === 'string' && ig.toLowerCase() === username.toLowerCase()) {
          return Number(c.id);
        }

        // 2) ПІБ у title ("Чат з <ПІБ>") — нечутливо до регістру
        if (fullName && typeof c?.title === 'string') {
          const hay = c.title.replace(/\s+/g, ' ').toLowerCase();
          const fn  = fullName.replace(/\s+/g, ' ').toLowerCase();
          if (hay.includes(fn) || hay.includes(`чат з ${fn}`)) {
            return Number(c.id);
          }
        }
      }

      const total = (meta as any)?.total ?? (meta?.meta?.total ?? undefined);
      const got   = Array.isArray(data) ? data.length : 0;
      if (!got || (total && page * perPage >= total)) break; // більше нічого не буде
      page += 1;
    }
  } finally {
    clearTimeout(timer);
  }

  return null;
}
