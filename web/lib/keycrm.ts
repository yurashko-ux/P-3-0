// web/lib/keycrm.ts
// Уніфікована обгортка над KeyCRM з дефолтом на LEADS та м'якими фолбеками.
// Важливо: шляхи формуємо без початкового '/', щоб не з'їсти '/v1' у BASE_URL.

const BASE_URL = process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1';
const TOKEN = process.env.KEYCRM_API_TOKEN || '';

function apiPath(p: string) {
  return new URL(p.replace(/^\/+/, ''), BASE_URL).toString();
}

function authHeaders() {
  if (!TOKEN) throw new Error('KEYCRM_API_TOKEN is not set');
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
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
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`KeyCRM GET non-JSON at ${url} :: ${text.slice(0, 400)}`);
  }
}

async function httpPut(path: string, body: any) {
  const url = apiPath(path);
  const res = await fetch(url, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`KeyCRM PUT ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text ? { ok: true, raw: text } : { ok: true };
  }
}

/* ===================== Public API ===================== */

/** Пайплайни (unified) */
export async function kcGetPipelines(): Promise<any[]> {
  // Основний: pipelines
  const j = await httpGet('pipelines');
  return Array.isArray(j) ? j : j?.data ?? [];
}

/** Статуси в пайплайні (уніфіковано) */
export async function kcGetStatuses(pipelineId: number): Promise<any[]> {
  // Пробуємо canonical шлях
  try {
    const j = await httpGet(`pipelines/${pipelineId}/statuses`);
    return Array.isArray(j) ? j : j?.data ?? [];
  } catch {
    // Фолбек на можливий варіант зі списком усіх статусів + фільтр
    const j2 = await httpGet('statuses', { pipeline_id: pipelineId });
    const arr = Array.isArray(j2) ? j2 : j2?.data ?? [];
    return arr.filter((s: any) => Number(s?.pipeline_id ?? s?.pipeline?.id) === Number(pipelineId));
  }
}

/** Пагінований знімок лід-карток; path за замовчуванням — 'leads'. */
export async function kcListLeads(params: {
  page?: number;
  per_page?: number;
  pipeline_id?: number;
  status_id?: number;
  path?: string; // можна передати інший ресурс без '/' (наприклад, 'leads', 'deals')
}): Promise<{ items: any[]; hasNext: boolean; raw: any }> {
  const path = (params.path || 'leads').replace(/^\/+/, '');
  const j = await httpGet(path, {
    page: params.page ?? 1,
    per_page: params.per_page ?? 50,
    pipeline_id: params.pipeline_id,
    status_id: params.status_id,
  });
  const data = Array.isArray(j) ? j : j?.data ?? [];
  const hasNext = Boolean((Array.isArray(j) ? null : j?.next_page_url) ?? false);
  return { items: data, hasNext, raw: j };
}

/** Зміна статусу/пайплайна для картки — спочатку пробуємо LEADS, далі фолбек на DEALS */
export async function kcMoveCard(params: {
  id: number | string;
  pipeline_id?: number;
  status_id?: number;
  // інколи API вимагає обгортку; робимо мінімально необхідне тіло
}): Promise<any> {
  const body: Record<string, any> = {};
  if (params.pipeline_id != null) body.pipeline_id = Number(params.pipeline_id);
  if (params.status_id != null) body.status_id = Number(params.status_id);

  // 1) Leads
  try {
    return await httpPut(`leads/${params.id}`, body);
  } catch (e) {
    // 2) Fallback → Deals (на випадок старих інсталяцій/прав доступу)
    return await httpPut(`deals/${params.id}`, body);
  }
}

/** Допоміжний пошук — може знадобитись у локальних інструментах */
export async function kcGetLead(id: number | string): Promise<any> {
  const j = await httpGet(`leads/${id}`);
  return j;
}
