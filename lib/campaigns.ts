// lib/campaigns.ts
import { kvGet, kvZRange } from "@/lib/kv";

export type CampaignStep = {
  pipeline_id: number;
  status_id: number;
  trigger?: string | number; // для V1/V2/EXP
  label?: string;            // текст бейджу у UI
};

export type Campaign = {
  id: string;
  name: string;
  active: boolean;
  base: CampaignStep; // обовʼязково
  v1?: CampaignStep;
  v2?: CampaignStep;
  exp?: CampaignStep;
  created_at?: string;
  updated_at?: string;
};

// головний ключ активної кампанії: campaign:active:id => "<id>"
const KEY_ACTIVE_ID = "campaign:active:id";
// індекс усіх кампаній (за бажанням): campaign:index (zset/array з ids)

export async function getActiveCampaign(): Promise<Campaign | null> {
  // 1) прямий ключ активної
  const activeId = await kvGet<string>(KEY_ACTIVE_ID);
  if (activeId) {
    const byId = await kvGet<Campaign>(`campaign:${activeId}`);
    if (byId?.active) return byId;
  }

  // 2) fallback — знаходимо першу активну зі списку
  const ids =
    (await kvZRange<string>("campaign:index", 0, -1)) ??
    (await kvZRange<string>("campaigns:index", 0, -1)) ??
    [];

  for (const id of ids) {
    const c = await kvGet<Campaign>(`campaign:${id}`);
    if (c?.active) return c;
  }

  return null;
}
