// web/lib/keycrm.ts
// Єдина обгортка під KeyCRM з дефолтом на LEADS + сумісність зі старими імпортами.
// Важливо: Шляхи формуються без початкового '/', щоб не «з'їсти» '/v1' у BASE_URL.

import { kvZRange } from './kv';

const BASE_URL = process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1';
const TOKEN = process.env.KEYCRM_API_TOKEN || '';

// ---------- helpers ----------
function pathUrl(p: string) {
  return new URL(p.replace(/^\/+/, ''), BASE_URL).toString();
}
function authHeaders() {
  if (!TOKEN) throw new Error('KEYCRM_API_TOKEN is not set');
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
}
function normHandle(s?: string | null) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.replace(/^@+/, '').toLowerCase();
}
function safeJson(text: string, url: string) {
  try { return JSON.parse(text); }
  catch { throw new Error(`KeyCRM returned non-JSON at ${url} :: ${text.slice(0, 400)}`); }
}
async function httpGet(path: string, qs?: Record<string, any>) {
  const url = new URL(path.replace(/^\/+/, ''), BASE_URL);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { headers: authHeaders(), cache: 'no-store' });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`KeyCRM GET ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  return safeJson(text, url.toString());
}
async function httpPut(path: string, body: any) {
  const url = pathUrl(path);
  const res = await fetch(url, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`KeyCRM PUT ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return text ? { ok: true, raw: text } : { ok: true }; }
}

// ---------- public API (нові) ----------
export async function kcGetPipelines(): Promise<any[]> {
  const j = await httpGet('pipelines');
  return Array.isArray(j) ? j : (j?.data ?? []);
}

export async function kcGetStatuses(pipelineId: number): Promise<any[]> {
  try {
    const j = await httpGet(`pipelines/${pipelineId}/statuses`);
    return Array.isArray(j) ? j : (j?.data ?? []);
  } catch {
    const j2 = await httpGet('statuses', { pipeline_id: pipelineId });
    const arr = Array.isArray(j2) ? j2 : (j2?.data ?? []);
    return arr.filter((s: any) => Number(s?.pipeline_id ?? s?.pipeline?.id) === Number(pipelineId));
  }
}

/** Пагінація по лід-картках. path='leads' за замовчуванням. */
export async function kcListLeads(params: {
  page?: number; per_page?: number; pipeline_id?: number; status_id?: number; path?: string;
}): Promise<{ items: any[]; hasNext: boolean; raw: any }> {
  const path = (params.path || 'leads').replace(/^\/+/, '');
  const j = await httpGet(path, {
    page: params.page ?? 1,
    per_page: params.per_page ?? 50,
    pipeline_id: params.pipeline_id,
    status_id: params.status_id,
  });
  const data = Array.isArray(j) ? j : (j?.data ?? []);
  const hasNext = Boolean((Array.isArray(j) ? null : j?.next_page_url) ?? false);
  return { items: data, hasNext, raw: j };
}

export async function kcGetLead(id: number | string): Promise<any> {
  return httpGet(`leads/${id}`);
}

/** Зміна статусу/воронки для картки — спочатку leads, потім fallback на deals */
export async function kcMoveCard(params: { id: number | string; pipeline_id?: number; status_id?: number; }): Promise<any> {
  const body: Record<string, any> = {};
  if (params.pipeline_id != null) body.pipeline_id = Number(params.pipeline_id);
  if (params.status_id != null) body.status_id = Number(params.status_id);
  try { return await httpPut(`leads/${params.id}`, body); }
  catch { return await httpPut(`deals/${params.id}`, body); }
}

// ---------- сумісність зі старими імпортами ----------
/** Старі роутери очікують "Laravel-сторінки". Даємо синонім до kcListLeads. */
export async function kcListCardsLaravel(params: {
  page?: number; per_page?: number; pipeline_id?: number; status_id?: number; path?: string;
}): Promise<{ items: any[]; hasNext: boolean; raw: any }> {
  return kcListLeads(params);
}

/** Пошук card_id по IG username через локальний індекс (створений під час sync). */
export async function findCardIdByUsername(username?: string | null): Promise<number | null> {
  const handle = normHandle(username || '');
  if (!handle) return null;
  // індекси будуються як kc:index:social:instagram:<handle> і дубль з '@<handle>'
  const keys = [`kc:index:social:instagram:${handle}`, `kc:index:social:instagram:@${handle}`];
  for (const key of keys) {
    const ids: string[] = await kvZRange(key, 0, -1, { rev: true }).catch(() => []);
    if (ids && ids.length) return Number(ids[0]);
  }
  return null;
}

/** Універсальний пошук: спочатку username через індекс; далі — (опц.) перебір по Leads. */
export async function kcFindCardIdByAny(params: {
  username?: string | null;
  fullname?: string | null;
  pipeline_id?: number;
  status_id?: number;
  path?: string;        // дефолт 'leads'
  max_pages?: number;   // скільки сторінок переглянути у fallback
  per_page?: number;
}): Promise<number | null> {
  // 1) найшвидший шлях — по індексу username
  const fromIndex = await findCardIdByUsername(params.username);
  if (fromIndex) return fromIndex;

  // 2) опційний перебір по Leads у межах пари (повільніше; використовується лише як fallback)
  const pipelineId = Number(params.pipeline_id ?? NaN);
  const statusId = Number(params.status_id ?? NaN);
  if (!Number.isFinite(pipelineId) || !Number.isFinite(statusId)) return null;

  const per_page = params.per_page ?? 50;
  const max_pages = params.max_pages ?? 2;
  const needle = String(params.fullname ?? '').trim().toLowerCase();

  let page = 1;
  while (page <= max_pages) {
    const { items, hasNext } = await kcListLeads({
      page,
      per_page,
      pipeline_id: pipelineId,
      status_id: statusId,
      path: (params.path || 'leads'),
    });

    // клієнтська фільтрація за парою (на випадок, якщо API не фільтрує)
    const filtered = items.filter((raw: any) => {
      const p = raw?.status?.pipeline_id ?? raw?.pipeline_id;
      const s = raw?.status_id ?? raw?.status?.id;
      return Number(p) === pipelineId && Number(s) === statusId;
    });

    for (const raw of filtered) {
      const title = String(raw?.title ?? '').toLowerCase();
      const fn = String(raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? '').toLowerCase();
      if (needle && (title.includes(needle) || fn.includes(needle))) {
        return Number(raw?.id);
      }
    }

    if (!hasNext) break;
    page += 1;
  }

  return null;
}
