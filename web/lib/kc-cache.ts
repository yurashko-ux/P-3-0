// web/lib/kc-cache.ts
import { kvGet, kvSet } from '@/lib/kv';

const PIPELINES_KEY = 'kc:meta:pipelines';
const STATUSES_KEY = (p: number) => `kc:meta:statuses:${p}`;
const TTL_SECONDS = 3600;

const BASE_URL = process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1';
const TOKEN = process.env.KEYCRM_API_TOKEN || '';

async function keycrmFetch(path: string, search?: Record<string, any>) {
  const url = new URL(path, BASE_URL);
  if (search) {
    Object.entries(search).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    // на Vercel це серверний контекст
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KeyCRM ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

async function kcFetchPipelines(): Promise<Array<{ id: number; name?: string; title?: string }>> {
  // припускаємо, що API повертає { data: [...] } або просто масив — покриємо обидва
  const json = await keycrmFetch('/pipelines');
  return Array.isArray(json) ? json : json?.data ?? [];
}

async function kcFetchStatuses(pipelineId: number): Promise<Array<{ id: number; name?: string; title?: string }>> {
  const json = await keycrmFetch('/pipelines/statuses', { pipeline_id: pipelineId });
  return Array.isArray(json) ? json : json?.data ?? [];
}

export async function getPipelineName(id?: number | null) {
  if (!id) return null;
  let map = await kvGet<Record<string, string>>(PIPELINES_KEY);
  if (!map || !map[String(id)]) {
    const list = await kcFetchPipelines();
    map = Object.fromEntries(
      list.map((p: any) => [String(p.id), String(p.name || p.title || '')]),
    );
    await kvSet(PIPELINES_KEY, map, { ex: TTL_SECONDS });
  }
  return map[String(id)] ?? null;
}

export async function getStatusName(
  pipelineId?: number | null,
  statusId?: number | null,
) {
  if (!pipelineId || !statusId) return null;
  const key = STATUSES_KEY(pipelineId);
  let map = await kvGet<Record<string, string>>(key);
  if (!map || !map[String(statusId)]) {
    const list = await kcFetchStatuses(pipelineId);
    map = Object.fromEntries(
      list.map((s: any) => [String(s.id), String(s.name || s.title || '')]),
    );
    await kvSet(key, map, { ex: TTL_SECONDS });
  }
  return map[String(statusId)] ?? null;
}
