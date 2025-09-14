// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRevRange } from "@/lib/kv";
import { assertAdmin } from "@/lib/auth";
import { kcGetPipelines } from "@/lib/keycrm";

/**
 * Локальний хелпер: отримати статуси воронки з KeyCRM напряму по REST.
 * Уникаємо неіснуючого імпорту kcGetStatusesByPipeline.
 */
async function getStatusesByPipeline(pipelineId: number): Promise<any[]> {
  const base = process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1";
  const token = process.env.KEYCRM_API_TOKEN;
  if (!token) return [];

  const res = await fetch(`${base}/pipelines/${pipelineId}/statuses`, {
    headers: { Authorization: `Bearer ${token}` },
    // запобігаємо кешуванню на edge
    cache: "no-store",
  }).catch(() => null);

  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => null);
  // KeyCRM зазвичай повертає { data: [] }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

// Типи з KV
type Rule = {
  field: "text";
  op: "contains" | "equals";
  value: string;
  to_pipeline_id?: number | string | null;
  to_status_id?: number | string | null;
};

type CampaignKV = {
  id: string;
  name: string;
  active?: boolean;

  base_pipeline_id: number | string;
  base_status_id: number | string;

  rules: {
    v1: Rule;
    v2?: Rule | null;
  };

  v1_to_pipeline_id?: number | string | null;
  v1_to_status_id?: number | string | null;

  v2_to_pipeline_id?: number | string | null;
  v2_to_status_id?: number | string | null;

  exp_days?: number | string | null;
  exp_to_pipeline_id?: number | string | null;
  exp_to_status_id?: number | string | null;

  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  created_at?: number;
  updated_at?: number;
};

function numOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function hasNonEmpty(str?: string | null) {
  return !!(str && String(str).trim().length > 0);
}

export async function GET(req: Request) {
  await assertAdmin(req);

  // останні зверху
  const ids = (await kvZRevRange("campaigns:index", 0, -1).catch(() => [])) as string[];
  const campaigns: CampaignKV[] = [];
  for (const id of ids ?? []) {
    const c = (await kvGet<CampaignKV>(`campaigns:${id}`)) as CampaignKV | null;
    if (c) campaigns.push(c);
  }

  // які pipeline/status треба розвʼязати в назви
  const pipelineIds = new Set<number>();
  const statusByPipeline = new Map<number, Set<number>>();
  const addPair = (p?: any, s?: any) => {
    const pn = numOrNull(p);
    const sn = numOrNull(s);
    if (pn) {
      pipelineIds.add(pn);
      if (sn) {
        if (!statusByPipeline.has(pn)) statusByPipeline.set(pn, new Set<number>());
        statusByPipeline.get(pn)!.add(sn);
      }
    }
  };

  for (const c of campaigns) {
    addPair(c.base_pipeline_id, c.base_status_id);

    const v1p = c.v1_to_pipeline_id ?? c.rules?.v1?.to_pipeline_id;
    const v1s = c.v1_to_status_id ?? c.rules?.v1?.to_status_id;
    addPair(v1p, v1s);

    if (c.rules?.v2 && hasNonEmpty(c.rules.v2.value)) {
      const v2p = c.v2_to_pipeline_id ?? c.rules.v2.to_pipeline_id;
      const v2s = c.v2_to_status_id ?? c.rules.v2.to_status_id;
      addPair(v2p, v2s);
    }

    addPair(c.exp_to_pipeline_id, c.exp_to_status_id);
  }

  // словники назв
  const pipelinesList = await kcGetPipelines().catch(() => []);
  const pipelinesById = new Map<number, string>();
  for (const p of pipelinesList as any[]) {
    const id = numOrNull(p?.id);
    if (id) pipelinesById.set(id, String(p?.name ?? p?.title ?? `#${id}`));
  }

  const statusesByPipe = new Map<number, Map<number, string>>();
  for (const pId of pipelineIds) {
    const fetched = await getStatusesByPipeline(pId).catch(() => []);
    const map = new Map<number, string>();
    for (const s of fetched as any[]) {
      const sid = numOrNull(s?.id);
      if (sid) map.set(sid, String(s?.name ?? s?.title ?? `#${sid}`));
    }
    // додамо плейсхолдери для запитаних id, яких нема у відповіді
    for (const want of statusByPipeline.get(pId) ?? []) {
      if (!map.has(want)) map.set(want, `#${want}`);
    }
    statusesByPipe.set(pId, map);
  }

  const namePipe = (id?: any) => {
    const n = numOrNull(id);
    if (!n) return "—";
    return pipelinesById.get(n) ?? `#${n}`;
  };
  const nameStatus = (p?: any, s?: any) => {
    const pn = numOrNull(p);
    const sn = numOrNull(s);
    if (!pn || !sn) return "—";
    return statusesByPipe.get(pn)?.get(sn) ?? `#${sn}`;
  };

  // будуємо вихід
  const out = campaigns.map((c) => {
    const v1p = c.v1_to_pipeline_id ?? c.rules?.v1?.to_pipeline_id;
    const v1s = c.v1_to_status_id ?? c.rules?.v1?.to_status_id;

    const hasV2 = c.rules?.v2 && hasNonEmpty(c.rules.v2.value);
    const v2p = hasV2 ? (c.v2_to_pipeline_id ?? c.rules?.v2?.to_pipeline_id) : null;
    const v2s = hasV2 ? (c.v2_to_status_id ?? c.rules?.v2?.to_status_id) : null;

    return {
      ...c,

      // База
      base_pipeline_name: namePipe(c.base_pipeline_id),
      base_status_name: nameStatus(c.base_pipeline_id, c.base_status_id),

      // V1
      v1_to_pipeline_id: numOrNull(v1p),
      v1_to_status_id: numOrNull(v1s),
      v1_to_pipeline_name: namePipe(v1p),
      v1_to_status_name: nameStatus(v1p, v1s),

      // V2
      has_v2: !!hasV2,
      v2_to_pipeline_id: numOrNull(v2p),
      v2_to_status_id: numOrNull(v2s),
      v2_to_pipeline_name: namePipe(v2p),
      v2_to_status_name: nameStatus(v2p, v2s),

      // Exp
      exp_to_pipeline_name: namePipe(c.exp_to_pipeline_id),
      exp_to_status_name: nameStatus(c.exp_to_pipeline_id, c.exp_to_status_id),
    };
  });

  return NextResponse.json({ items: out });
}
