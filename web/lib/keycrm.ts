// web/lib/keycrm.ts
// KeyCRM client: використовує GET /pipelines/cards (а не /leads).

import { kvZRange } from './kv';

/* ENV сумісність і автододавання /v1 */
const RAW_BASE =
  process.env.KEYCRM_BASE_URL ||
  process.env.KEYCRM_API_URL ||
  'https://openapi.keycrm.app/v1';
const TOKEN =
  process.env.KEYCRM_API_TOKEN ||
  process.env.KEYCRM_BEARER ||
  '';

function ensureV1(base: string): string {
  let url = (base || '').trim().replace(/\/+$/g, '');
  if (!url) url = 'https://openapi.keycrm.app/v1';
  if (!/\/v\d+($|\/)/i.test(url)) url = url + '/v1';
  return url + '/';
}
const BASE_URL = ensureV1(RAW_BASE);

function authHeaders() {
  if (!TOKEN) throw new Error('KEYCRM_API_TOKEN (або KEYCRM_BEARER) is not set');
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
}
function safeJson(text: string, url: string) {
  try { return JSON.parse(text); }
  catch { throw new Error(`KeyCRM returned non-JSON at ${url} :: ${text.slice(0, 400)}`); }
}
async function httpGet(path: string, qs?: Record<string, any>) {
  const url = new URL(path.replace(/^\/+/, ''), BASE_URL);
  if (qs) for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: authHeaders(), cache: 'no-store' });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`KeyCRM GET ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  return safeJson(text, url.toString());
}
async function httpPut(path: string, body: any) {
  const url = new URL(path.replace(/^\/+/, ''), BASE_URL).toString();
  const res = await fetch(url, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`KeyCRM PUT ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return text ? { ok: true, raw: text } : { ok: true }; }
}

/* ───────── Метадані ───────── */
export async function kcGetPipelines(): Promise<any[]> {
  const j = await httpGet('pipelines');
  return Array.isArray(j) ? j : (j?.data ?? []);
}
export async function kcGetStatuses(pipelineId: number): Promise<any[]> {
  // офіційний шлях зі скріну
  const j = await httpGet(`pipelines/${pipelineId}/statuses`);
  return Array.isArray(j) ? j : (j?.data ?? []);
}

/* ───────── Список карток (лідів) у воронках ─────────
   Відповідає GET /pipelines/cards із фільтрами pipeline_id/status_id.
*/
export async function kcListCards(params: {
  page?: number; per_page?: number;
  pipeline_id?: number; status_id?: number;
}): Promise<{ items: any[]; hasNext: boolean; raw: any }> {
  const j = await httpGet('pipelines/cards', {
    page: params.page ?? 1,
    per_page: params.per_page ?? 50,
    pipeline_id: params.pipeline_id,
    status_id: params.status_id,
  });
  const data = Array.isArray(j) ? j : (j?.data ?? []);
  const hasNext = Boolean((Array.isArray(j) ? null : j?.next_page_url) ?? false);
  return { items: data, hasNext, raw: j };
}

export async function kcGetCard(id: number | string): Promise<any> {
  return httpGet(`pipelines/cards/${id}`);
}

export async function kcMoveCard(params: { id: number | string; pipeline_id?: number; status_id?: number; }): Promise<any> {
  const body: Record<string, any> = {};
  if (params.pipeline_id != null) body.pipeline_id = Number(params.pipeline_id);
  if (params.status_id != null) body.status_id = Number(params.status_id);
  return httpPut(`pipelines/cards/${params.id}`, body);
}

/* ───────── Пошук по username через локальний індекс (якщо він є) ───────── */
function normHandle(s?: string | null) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.replace(/^@+/, '').toLowerCase();
}
export async function findCardIdByUsername(username?: string | null): Promise<number | null> {
  const h = normHandle(username || '');
  if (!h) return null;
  for (const key of [`kc:index:social:instagram:${h}`, `kc:index:social:instagram:@${h}`]) {
    const ids: string[] = await kvZRange(key, 0, -1).catch(() => []);
    const latestFirst = Array.isArray(ids) ? [...ids].reverse() : [];
    if (latestFirst.length) return Number(latestFirst[0]);
  }
  return null;
}

/* ───────── Live-пошук у /pipelines/cards ───────── */
export async function kcFindCardIdByAny(params: {
  username?: string | null;
  fullname?: string | null;
  pipeline_id?: number | string;
  status_id?: number | string;
  per_page?: number;
  max_pages?: number;
}): Promise<number | null> {
  const h = normHandle(params.username);
  const needle = String(params.fullname ?? '').trim().toLowerCase();
  const pipelineId = Number(params.pipeline_id ?? NaN);
  const statusId = Number(params.status_id ?? NaN);
  if (!Number.isFinite(pipelineId) || !Number.isFinite(statusId)) return null;

  let page = 1;
  const per_page = params.per_page ?? 50;
  const max_pages = params.max_pages ?? 2;

  while (page <= max_pages) {
    const { items, hasNext } = await kcListCards({ page, per_page, pipeline_id: pipelineId, status_id: statusId });

    for (const raw of items) {
      const pid = Number(raw?.status?.pipeline_id ?? raw?.pipeline_id);
      const sid = Number(raw?.status_id ?? raw?.status?.id);
      if (pid !== pipelineId || sid !== statusId) continue;

      const social = String(raw?.contact?.social_id ?? '').trim().toLowerCase();
      const title = String(raw?.title ?? '').toLowerCase();
      const fn = String(raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? '').toLowerCase();

      const usernameOk = h ? (social === h || social === '@' + h) : false;
      const fullnameOk = needle ? (title.includes(needle) || fn.includes(needle)) : false;

      if ((h && usernameOk) || (!h && fullnameOk) || (h && fullnameOk && (usernameOk || fullnameOk))) {
        return Number(raw?.id);
      }
    }

    if (!hasNext) break;
    page += 1;
  }
  return null;
}
