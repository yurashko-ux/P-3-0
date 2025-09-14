// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZRange, kvZRevRange, kvZAdd } from "@/lib/kv";
import { assertAdmin } from "@/lib/auth";
import { kcGetPipelines, kcGetStatusesByPipeline } from "@/lib/keycrm";

// Типи зберігаються в KV у такому вигляді
type Rule = {
  field: "text";
  op: "contains" | "equals";
  value: string;
  // інколи форми надсилають цілі саме всередині правила:
  to_pipeline_id?: number | string | null;
  to_status_id?: number | string | null;
};

type CampaignKV = {
  id: string;
  name: string;
  active?: boolean;

  // База (обовʼязково)
  base_pipeline_id: number | string;
  base_status_id: number | string;

  // Варіант 1 (обовʼязково rule.value, а куди рухати — у цих полях)
  rules: {
    v1: Rule;
    v2?: Rule | null;
  };

  // Цілі для V1/V2 можуть бути збережені як окремі поля
  v1_to_pipeline_id?: number | string | null;
  v1_to_status_id?: number | string | null;

  v2_to_pipeline_id?: number | string | null;
  v2_to_status_id?: number | string | null;

  // Expire (опціонально)
  exp_days?: number | string | null;
  exp_to_pipeline_id?: number | string | null;
  exp_to_status_id?: number | string | null;

  // Лічильники
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  // службові
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

  // беремо останні 1000 кампаній (нові зверху)
  const ids = await kvZRevRange("campaigns:index", 0, -1).catch(() => []) as string[]; // fall back якщо немає util
  const out: any[] = [];

  // 1) зчитуємо всі кампанії
  const campaigns: CampaignKV[] = [];
  for (const id of ids ?? []) {
    const c = (await kvGet<CampaignKV>(`campaigns:${id}`)) as CampaignKV | null;
    if (c) campaigns.push(c);
  }

  // 2) збираємо всі pipeline/status, які потрібно розвʼязати в назви
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

    // V1 цілі можуть бути як окремі поля, так і всередині rules.v1
    const v1p = c.v1_to_pipeline_id ?? c.rules?.v1?.to_pipeline_id;
    const v1s = c.v1_to_status_id ?? c.rules?.v1?.to_status_id;
    addPair(v1p, v1s);

    // V2 — тільки якщо rule існує і непорожній
    if (c.rules?.v2 && hasNonEmpty(c.rules.v2.value)) {
      const v2p = c.v2_to_pipeline_id ?? c.rules.v2.to_pipeline_id;
      const v2s = c.v2_to_status_id ?? c.rules.v2.to_status_id;
      addPair(v2p, v2s);
    }

    // Expire
    addPair(c.exp_to_pipeline_id, c.exp_to_status_id);
  }

  // 3) тягнемо словники з KeyCRM
  //    pipelines: Map<pipeline_id, pipeline_name>
  //    statuses:  Map<pipeline_id, Map<status_id, status_name>>
  const pipelinesList = await kcGetPipelines().catch(() => []);
  const pipelinesById = new Map<number, string>();
  for (const p of pipelinesList as any[]) {
    const id = numOrNull(p?.id);
    if (id) pipelinesById.set(id, String(p?.name ?? p?.title ?? `#${id}`));
  }

  const statusesByPipe = new Map<number, Map<number, string>>();
  for (const pId of pipelineIds) {
    const want = statusByPipeline.get(pId);
    const fetched = await kcGetStatusesByPipeline(pId).catch(() => []);
    const map = new Map<number, string>();
    for (const s of fetched as any[]) {
      const sid = numOrNull(s?.id);
      if (sid) map.set(sid, String(s?.name ?? s?.title ?? `#${sid}`));
    }
    statusesByPipe.set(pId, map);
    // гарантуємо, що навіть відсутні статуси будуть показані як #id
    for (const sid of want ?? []) {
      if (!map.has(sid)) map.set(sid, `#${sid}`);
    }
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

  // 4) будуємо вихід із розвʼязаними назвами
  for (const c of campaigns) {
    const v1p = c.v1_to_pipeline_id ?? c.rules?.v1?.to_pipeline_id;
    const v1s = c.v1_to_status_id ?? c.rules?.v1?.to_status_id;

    const hasV2 = c.rules?.v2 && hasNonEmpty(c.rules.v2.value);
    const v2p = hasV2 ? (c.v2_to_pipeline_id ?? c.rules?.v2?.to_pipeline_id) : null;
    const v2s = hasV2 ? (c.v2_to_status_id ?? c.rules?.v2?.to_status_id) : null;

    out.push({
      ...c,
      // БАЗА
      base_pipeline_name: namePipe(c.base_pipeline_id),
      base_status_name: nameStatus(c.base_pipeline_id, c.base_status_id),

      // V1
      v1_to_pipeline_id: numOrNull(v1p),
      v1_to_status_id: numOrNull(v1s),
      v1_to_pipeline_name: namePipe(v1p),
      v1_to_status_name: nameStatus(v1p, v1s),

      // V2 (якщо є)
      has_v2: !!hasV2,
      v2_to_pipeline_id: numOrNull(v2p),
      v2_to_status_id: numOrNull(v2s),
      v2_to_pipeline_name: namePipe(v2p),
      v2_to_status_name: nameStatus(v2p, v2s),

      // EXP (якщо є)
      exp_to_pipeline_name: namePipe(c.exp_to_pipeline_id),
      exp_to_status_name: nameStatus(c.exp_to_pipeline_id, c.exp_to_status_id),
    });
  }

  return NextResponse.json({ items: out });
}

// POST створення/оновлення – лишаємо як було.
// Якщо у вас у цьому файлі також є POST, не чіпайте його зараз.
// Головне — GET тепер віддає назви для Base/V1/V2/EXP і прапорець has_v2.
