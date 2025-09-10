// web/lib/keycrm.ts
// Набір утиліт для KeyCRM з "розумним" пошуком картки за title (== instagram username)

const BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || "";

type Json = any;

async function kcFetch(path: string, init?: RequestInit) {
  if (!TOKEN) {
    return { ok: false, status: 401, json: null };
  }
  const url = `${BASE}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.headers || {}),
    },
    cache: "no-store",
  }).catch(() => null);
  if (!r) return { ok: false, status: 502, json: null };
  let json: Json = null;
  try {
    json = await r.json();
  } catch {}
  return { ok: r.ok, status: r.status, json };
}

// У різних версіях API можуть бути різні параметри пошуку.
// Спробуємо кілька варіантів і зберемо кандидатів у єдиний список.
async function tryCollectCandidates(path: string) {
  const res = await kcFetch(path);
  if (!res.ok) return [];
  const j = res.json ?? {};
  const arr =
    (Array.isArray(j) && j) ||
    (Array.isArray(j.data) && j.data) ||
    (Array.isArray(j.items) && j.items) ||
    [];
  return arr;
}

function normTitle(v: string) {
  return (v || "").trim().replace(/^@/, "").toLowerCase();
}

// Збираємо кандидатів різними способами, відфільтровуємо по точній рівності title.
export async function kcFindCardsByTitle(username: string): Promise<Array<any>> {
  const u = normTitle(username);
  if (!u) return [];

  const variants = new Set<any>();

  // Варіанти пошуку (беремо все, що повертає масив data/items)
  const paths = [
    `/pipelines/cards?search=${encodeURIComponent(u)}`,
    `/cards?search=${encodeURIComponent(u)}`,
    `/pipelines/cards?title=${encodeURIComponent(u)}`,
    `/cards?title=${encodeURIComponent(u)}`,
  ];

  for (const p of paths) {
    const list = await tryCollectCandidates(p);
    for (const it of list) variants.add(it);
  }

  // Приводимо у масив і фільтруємо: title має дорівнювати username (без @, без регістру)
  const arr = Array.from(variants) as any[];
  return arr.filter((x) => normTitle(x?.title) === u);
}

// Обираємо "найкращу" картку: активну, найсвіжіший updated_at, або з найбільшим id.
function pickBest(cards: any[]) {
  if (!cards.length) return null;
  const nonDeleted = cards.filter((c) => !c?.deleted_at && !c?.archived_at);
  const pool = nonDeleted.length ? nonDeleted : cards.slice();

  const withDates = pool
    .map((c) => ({ c, t: Date.parse(String(c?.updated_at || c?.created_at || 0)) || 0 }))
    .sort((a, b) => b.t - a.t);

  if (withDates[0]?.t) return withDates[0].c;

  // fallback — найбільший id як «найсвіжіший»
  return pool
    .map((c) => ({ c, id: Number(String(c?.id)) || 0 }))
    .sort((a, b) => b.id - a.id)[0]?.c;
}

// Публічна ф-ція: повертаємо id «найкращої» картки по title.
export async function kcFindCardIdByTitleSmart(username: string): Promise<string> {
  const cards = await kcFindCardsByTitle(username);
  const best = pickBest(cards);
  return best ? String(best.id) : "";
}

// Отримати стан картки з endpoint, де гарантовано є pipeline_id/status_id
export async function kcGetCardState(cardId: string): Promise<{ pipeline_id: string; status_id: string } | null> {
  const res = await kcFetch(`/pipelines/cards/${encodeURIComponent(cardId)}`);
  if (!res.ok) return null;
  const d = res.json?.data ?? res.json ?? null;
  if (!d) return null;
  return { pipeline_id: String(d.pipeline_id ?? ""), status_id: String(d.status_id ?? "") };
}

// Переміщення картки (PUT pipelines/cards/{id})
export async function kcMoveCard(
  cardId: string,
  payload: { pipeline_id?: string; status_id?: string; note?: string }
) {
  const body = JSON.stringify({
    ...(payload.pipeline_id ? { pipeline_id: payload.pipeline_id } : {}),
    ...(payload.status_id ? { status_id: payload.status_id } : {}),
    ...(payload.note ? { note: payload.note } : {}),
  });
  return kcFetch(`/pipelines/cards/${encodeURIComponent(cardId)}`, { method: "PUT", body });
}
