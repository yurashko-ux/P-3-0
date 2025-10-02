// web/lib/keycrm-cache.ts
import { kv } from "@vercel/kv";
import { fetchPipelines, fetchStatuses } from "@/lib/keycrm";

const K_PIPELINES = "kcrm:pipelines";             // { id -> name }
const K_STATUSES = (p: string) => `kcrm:st:${p}`;  // { id -> name }
const TTL_MS = 6 * 60 * 60 * 1000; // 6 год

type Dict = Record<string, string>;
type Entry = { map: Dict; updatedAt: number };

async function getEntry(key: string): Promise<Entry | null> {
  const v = await kv.get<Entry | null>(key);
  return v && typeof v === "object" ? v : null;
}
async function setEntry(key: string, map: Dict) {
  const entry: Entry = { map, updatedAt: Date.now() };
  await kv.set(key, entry);
}

export async function getPipelinesMap(force = false): Promise<Dict> {
  if (!force) {
    const c = await getEntry(K_PIPELINES);
    if (c && Date.now() - c.updatedAt < TTL_MS) return c.map;
  }
  const list = await fetchPipelines();
  if (list.length) {
    const map = Object.fromEntries(list.map((p) => [String(p.id), String(p.name)]));
    await setEntry(K_PIPELINES, map);
    return map;
  }
  const fallback = await getEntry(K_PIPELINES);
  return fallback?.map ?? {};
}

export async function getStatusesMap(pid: string, force = false): Promise<Dict> {
  const key = K_STATUSES(pid);
  if (!force) {
    const c = await getEntry(key);
    if (c && Date.now() - c.updatedAt < TTL_MS) return c.map;
  }
  const list = await fetchStatuses(pid);
  if (list.length) {
    const map = Object.fromEntries(list.map((s) => [String(s.id), String(s.name)]));
    await setEntry(key, map);
    return map;
  }
  const fallback = await getEntry(key);
  return fallback?.map ?? {};
}
