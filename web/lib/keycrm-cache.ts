// web/lib/keycrm-cache.ts
import { kv } from "@vercel/kv";
import { fetchPipelines, fetchStatuses } from "@/lib/keycrm";

const K_PIPELINES = "kcrm:pipelines";             // { id -> name }
const K_STATUSES = (p: string) => `kcrm:st:${p}`;  // { id -> name }
const TTL_MS = 24 * 60 * 60 * 1000; // 1 день (за потреби змінити)

type Dict = Record<string, string>;
type CacheEntry = { map: Dict; updatedAt: number };

async function getDict(key: string): Promise<CacheEntry | null> {
  const v = await kv.get<CacheEntry | null>(key);
  return v && typeof v === "object" ? v : null;
}
async function setDict(key: string, map: Dict) {
  const entry: CacheEntry = { map, updatedAt: Date.now() };
  await kv.set(key, entry);
}

export async function getPipelinesMap(force = false): Promise<Dict> {
  if (!force) {
    const cached = await getDict(K_PIPELINES);
    if (cached && Date.now() - cached.updatedAt < TTL_MS) return cached.map;
  }
  const list = await fetchPipelines(); // safe: повертає [] при збої
  if (list.length) {
    const map = Object.fromEntries(list.map(p => [String(p.id), String(p.name)]));
    await setDict(K_PIPELINES, map);
    return map;
  }
  // fallback: віддати те, що було, навіть протерміноване
  const fallback = await getDict(K_PIPELINES);
  return fallback?.map ?? {};
}

export async function getStatusesMap(pipelineId: string, force = false): Promise<Dict> {
  const key = K_STATUSES(pipelineId);
  if (!force) {
    const cached = await getDict(key);
    if (cached && Date.now() - cached.updatedAt < TTL_MS) return cached.map;
  }
  const list = await fetchStatuses(pipelineId); // safe
  if (list.length) {
    const map = Object.fromEntries(list.map(s => [String(s.id), String(s.name)]));
    await setDict(key, map);
    return map;
  }
  const fallback = await getDict(key);
  return fallback?.map ?? {};
}

// Зручні гетери назв
export async function getPipelineNameCached(pipelineId: string): Promise<string> {
  const map = await getPipelinesMap(false);
  return map[pipelineId] ?? pipelineId;
}
export async function getStatusNameCached(pipelineId: string, statusId: string): Promise<string> {
  const map = await getStatusesMap(pipelineId, false);
  return map[statusId] ?? statusId;
}
