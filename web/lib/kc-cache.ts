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
    for (const [k, v] of Object.entries(search)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KeyCRM ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

async function kcFetchPipelines(): Promise<Array<{ id: number; name?: string; title?: string }>> {
  const json = await keycrmFetch('/pipelines');
  return Array.isArray(json) ? json : json?.data ?? [];
}

async function kcFetchStatuses(
  pipelineId: number,
): Promise<Array<{ id: number; name?: string; title?: string }>> {
  const json = await keycrmFetch('/pipelines/statuses', { pipeline_id: pipelineId });
  return Array.isArray(json) ? json : json?.data ?? [];
}

// Безпечне читання мапи з KV (kvGet може повертати string|object|null)
function ensureMap(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, string>;
  return {};
}

export async function getPipelineName(id?: number | null) {
  if (!id) return null;

  const raw = await kvGet<any>(PIPELINES_KEY);
  let map = ensureMap(raw);

  if (!map[String(id)]) {
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
  const raw = await kvGet<any>(key);
  let map = ensureMap(raw);

  if (!map[String(statusId)]) {
    const list = await kcFetchStatuses(pipelineId);
    map = Object.fromEntries(
      list.map((s: any) => [String(s.id), String(s.name || s.title || '')]),
    );
    await kvSet(key, map, { ex: TTL_SECONDS });
  }
  return map[String(statusId)] ?? null;
}
