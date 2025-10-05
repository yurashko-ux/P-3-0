import { kv } from "@vercel/kv";

export type CampaignTarget = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

export type CampaignRecord = {
  id: string;
  base?: CampaignTarget;
  active?: boolean;
} & Record<string, any>;

export const CAMPAIGN_IDS_KEY = "cmp:ids";
export const CAMPAIGN_ITEM_KEY = (id: string) => `cmp:item:${id}`;

const uniqueStrings = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

const toStringSafe = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value == null) return "";
  return String(value).trim();
};

export async function readCampaignIds(): Promise<string[]> {
  const arr = (await kv.get<string[] | null>(CAMPAIGN_IDS_KEY)) ?? [];
  let list: string[] = [];
  try {
    list = await kv.lrange<string>(CAMPAIGN_IDS_KEY, 0, -1);
  } catch {
    list = [];
  }
  const merged = [
    ...(Array.isArray(arr) ? arr : []),
    ...(Array.isArray(list) ? list : []),
  ];
  return uniqueStrings(merged.map((v) => toStringSafe(v)).filter(Boolean));
}

export async function writeCampaignId(newId: string) {
  const ids = await readCampaignIds();
  const next = uniqueStrings([toStringSafe(newId), ...ids]);
  await kv.set(CAMPAIGN_IDS_KEY, next);
}

export async function readCampaignRecords<T extends CampaignRecord = CampaignRecord>(): Promise<T[]> {
  const ids = await readCampaignIds();
  if (!ids.length) return [];
  const keys = ids.map((id) => CAMPAIGN_ITEM_KEY(id));
  const raw = await kv.mget<(T | null)[]>(...keys);
  const out: T[] = [];
  raw.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    const candidate = item as T & { id?: unknown };
    const id = toStringSafe(candidate.id ?? ids[idx]);
    if (!id) return;
    out.push({ ...candidate, id } as T);
  });
  return out;
}

export function isCampaignActive(item: { active?: boolean } | null | undefined) {
  if (!item) return false;
  return item.active !== false;
}

const sameBase = (a?: CampaignTarget, b?: CampaignTarget) => {
  if (!a || !b) return false;
  const ap = toStringSafe(a.pipeline);
  const as = toStringSafe(a.status);
  const bp = toStringSafe(b.pipeline);
  const bs = toStringSafe(b.status);
  return !!ap && !!as && ap === bp && as === bs;
};

export async function findActiveBaseConflict(
  base?: CampaignTarget | null,
  opts: { ignoreId?: string } = {}
): Promise<CampaignRecord | null> {
  const pipeline = toStringSafe(base?.pipeline);
  const status = toStringSafe(base?.status);
  if (!pipeline || !status) return null;

  const list = await readCampaignRecords();
  const ignore = opts.ignoreId ? toStringSafe(opts.ignoreId) : "";

  for (const item of list) {
    if (!item) continue;
    if (ignore && toStringSafe(item.id) === ignore) continue;
    if (!isCampaignActive(item)) continue;
    if (sameBase(item.base, { pipeline, status })) {
      return item;
    }
  }

  return null;
}

export const campaignHelpers = {
  CAMPAIGN_IDS_KEY,
  CAMPAIGN_ITEM_KEY,
  readCampaignIds,
  writeCampaignId,
  readCampaignRecords,
  findActiveBaseConflict,
  isCampaignActive,
};

export default campaignHelpers;
