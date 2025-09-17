// web/lib/kc-cache.ts
import { kvGet, kvSet } from '@/lib/kv';
import { kcGetPipelines, kcGetStatuses } from '@/lib/keycrm';

const PIPELINES_KEY = 'kc:meta:pipelines';
const STATUSES_KEY = (p: number) => `kc:meta:statuses:${p}`;
const TTL_SECONDS = 3600;

export async function getPipelineName(id?: number | null) {
  if (!id) return null;
  let map = await kvGet<Record<string, string>>(PIPELINES_KEY);
  if (!map || !map[String(id)]) {
    const list = await kcGetPipelines();
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
    const list = await kcGetStatuses(pipelineId);
    map = Object.fromEntries(
      list.map((s: any) => [String(s.id), String(s.name || s.title || '')]),
    );
    await kvSet(key, map, { ex: TTL_SECONDS });
  }
  return map[String(statusId)] ?? null;
}
