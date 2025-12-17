// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getPipelineName, getStatusName } from "@/lib/keycrm";
import { kvRead, kvWrite } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const IDS_LIST_KEY = "cmp:ids:list";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

type Target = {
  pipeline?: string;
  status?: string;
  pipelineStatusId?: string;
  pipelineName?: string;
  statusName?: string;
};

type Counters = { v1: number; v2: number; exp: number };

type Rule = {
  op: "equals" | "contains";
  value: string;
  pipeline_id?: number | string;
  status_id?: number | string;
  pipeline_status_id?: number | string;
  pipelineName?: string;
  statusName?: string;
};

type Campaign = {
  id: string;
  name: string;
  base?: Target;
  t1?: Target;
  t2?: Target;
  texp?: Target;
  base_pipeline_id?: string;
  base_status_id?: string;
  base_pipeline_status_id?: string;
  base_pipeline_name?: string;
  base_status_name?: string;
  v1_to_pipeline_id?: string;
  v1_to_status_id?: string;
  v1_to_pipeline_status_id?: string;
  v1_to_pipeline_name?: string;
  v1_to_status_name?: string;
  v2_to_pipeline_id?: string;
  v2_to_status_id?: string;
  v2_to_pipeline_status_id?: string;
  v2_to_pipeline_name?: string;
  v2_to_status_name?: string;
  v1?: string;
  v2?: string;
  rules?: Record<string, Rule>;
  expDays?: number;
  expireDays?: number;
  expire?: number;
  vexp?: number;
  exp?: number; // ⬅️ додав exp
  counters: Counters;
  createdAt: number;
  // статистика
  baseCardsCount?: number;
  baseCardsCountInitial?: number;
  baseCardsCountUpdatedAt?: number;
  movedTotal?: number;
  movedV1?: number;
  movedV2?: number;
  movedExp?: number;
};

type CampaignMemoryStore = {
  ids: string[];
  items: Record<string, Campaign>;
};

type CampaignKvState = {
  disabled: boolean;
  error: Error | null;
};

const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

const globalAny = globalThis as typeof globalThis & {
  __campaignMemoryStore?: CampaignMemoryStore;
  __campaignKvState?: CampaignKvState;
};

const memoryStore: CampaignMemoryStore =
  globalAny.__campaignMemoryStore ??
  (globalAny.__campaignMemoryStore = { ids: [], items: Object.create(null) });

const kvState: CampaignKvState =
  globalAny.__campaignKvState ??
  (globalAny.__campaignKvState = { disabled: false, error: null });

function noteKvError(err: unknown) {
  if (kvState.disabled) return;
  kvState.disabled = true;
  kvState.error = err instanceof Error ? err : new Error(String(err));
  console.warn("[campaigns] KV disabled:", kvState.error?.message ?? kvState.error);
}

async function tryKv<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (kvState.disabled) return undefined;
  try {
    return await fn();
  } catch (err) {
    noteKvError(err);
    return undefined;
  }
}

function memoryReadIds(): string[] {
  return [...memoryStore.ids];
}

function memoryWriteId(id: string) {
  memoryStore.ids = unique([id, ...memoryStore.ids]);
}

function memorySetItem(id: string, value: Campaign) {
  memoryStore.items[id] = value;
  memoryWriteId(id);
}

function memoryGetItems(ids: string[]): (Campaign | null)[] {
  return ids.map((id) => memoryStore.items[id] ?? null);
}

function isWrongTypeError(err: unknown): boolean {
  return err instanceof Error && /WRONGTYPE/i.test(err.message);
}

async function readIdsMerged(): Promise<string[]> {
  let arr: string[] | undefined;
  if (!kvState.disabled) {
    try {
      const value = await kv.get<string[] | null>(IDS_KEY);
      if (Array.isArray(value)) {
        arr = value;
      }
    } catch (err) {
      if (!isWrongTypeError(err)) {
        noteKvError(err);
      }
    }
  }

  let list: string[] | undefined;
  if (!kvState.disabled) {
    try {
      const value = await kvRead.lrange(IDS_LIST_KEY, 0, -1);
      if (Array.isArray(value)) {
        list = value;
      }
    } catch (err) {
      if (!isWrongTypeError(err)) {
        noteKvError(err);
      }
    }
  }

  if (arr !== undefined || list !== undefined) {
    return unique([
      ...(Array.isArray(arr) ? arr : []),
      ...(Array.isArray(list) ? list : []),
    ]);
  }

  return memoryReadIds();
}

async function writeIdsMerged(newId: string) {
  const merged = unique([newId, ...(await readIdsMerged())]);
  memoryWriteId(newId);
  await tryKv(() => kv.set(IDS_KEY, merged));
  await tryKv(() => kvWrite.lpush(IDS_LIST_KEY, newId));
  await tryKv(() => kvWrite.ltrim(IDS_LIST_KEY, 0, 199));
}

const pickStr = (x: any) => (x == null ? undefined : (String(x).trim() || undefined));
const pickNum = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};

const pickBool = (x: any) => {
  if (typeof x === "boolean") return x;
  if (x == null) return undefined;
  const str = String(x).trim().toLowerCase();
  if (!str) return undefined;
  if (["true", "1", "yes", "y"].includes(str)) return true;
  if (["false", "0", "no", "n"].includes(str)) return false;
  return undefined;
};

function parseRule(input: any): Rule | null {
  if (!input || typeof input !== "object") return null;

  const value = pickStr(
    input.value ?? input.val ?? input.text ?? input.rule ?? input.name ?? input.pattern,
  );
  if (!value) return null;

  const opRaw = pickStr(input.op ?? input.operator ?? input.compare);
  const op: "equals" | "contains" = opRaw === "equals" ? "equals" : "contains";

  const pipelineCandidate =
    pickNum(input.pipeline_id ?? input.pipelineId ?? input.pipeline ?? input.to_pipeline_id) ??
    pickStr(input.pipeline_id ?? input.pipelineId ?? input.pipeline ?? input.to_pipeline_id);

  const pipelineStatusCandidate =
    pickNum(
      input.pipeline_status_id ??
        input.pipelineStatusId ??
        input.pipeline_status ??
        input.status_pipeline_id ??
        input.pipelineStatus,
    ) ??
    pickStr(
      input.pipeline_status_id ??
        input.pipelineStatusId ??
        input.pipeline_status ??
        input.status_pipeline_id ??
        input.pipelineStatus,
    );

  const statusCandidate =
    pickNum(input.status_id ?? input.statusId ?? input.status) ??
    pickStr(input.status_id ?? input.statusId ?? input.status) ??
    pipelineStatusCandidate;

  const pipelineName = pickStr(input.pipelineName ?? input.pipeline_name);
  const statusName = pickStr(input.statusName ?? input.status_name);

  const rule: Rule = { op, value };
  if (pipelineCandidate != null) rule.pipeline_id = pipelineCandidate;
  if (statusCandidate != null) rule.status_id = statusCandidate;
  if (pipelineStatusCandidate != null) rule.pipeline_status_id = pipelineStatusCandidate;
  if (pipelineName) rule.pipelineName = pipelineName;
  if (statusName) rule.statusName = statusName;
  return rule;
}

function targetFromRule(rule?: Rule | null): Target | undefined {
  if (!rule) return undefined;

  const pipeline = pickStr(rule.pipeline_id ?? (rule as any).pipeline);
  const status = pickStr(rule.status_id ?? (rule as any).status);
  const pipelineStatusId = pickStr(
    (rule as any).pipeline_status_id ??
      (rule as any).pipelineStatusId ??
      (rule as any).pipeline_status,
  );
  const pipelineName = pickStr(rule.pipelineName ?? (rule as any).pipeline_name);
  const statusName = pickStr(rule.statusName ?? (rule as any).status_name);

  const out: Target = {
    pipeline: pipeline,
    status: status,
    pipelineStatusId,
    pipelineName: pipelineName,
    statusName: statusName,
  };

  return out.pipeline || out.status || out.pipelineName || out.statusName ? out : undefined;
}

function targetFromFlat(src: Record<string, any>, prefix: string): Target | undefined {
  const get = (...ks: string[]) => ks.map((k) => src[k]).find((v) => v != null);
  const pipeline =
    get(`${prefix}.pipeline`, `${prefix}_pipeline`, `${prefix}Pipeline`) ?? src[prefix]?.pipeline;
  const status = get(`${prefix}.status`, `${prefix}_status`, `${prefix}Status`) ?? src[prefix]?.status;
  const pipelineStatusId =
    get(
      `${prefix}.pipelineStatusId`,
      `${prefix}_pipelineStatusId`,
      `${prefix}PipelineStatusId`,
      `${prefix}.pipeline_status_id`,
      `${prefix}_pipeline_status_id`,
      `${prefix}Pipeline_status_id`,
      `${prefix}.pipelineStatus`,
      `${prefix}_pipelineStatus`,
      `${prefix}PipelineStatus`,
    ) ??
    src[prefix]?.pipelineStatusId ??
    src[prefix]?.pipeline_status_id ??
    src[prefix]?.pipelineStatus;
  const pipelineName =
    get(`${prefix}.pipelineName`, `${prefix}_pipelineName`, `${prefix}PipelineName`) ??
    src[prefix]?.pipelineName;
  const statusName =
    get(`${prefix}.statusName`, `${prefix}_statusName`, `${prefix}StatusName`) ??
    src[prefix]?.statusName;
  const out: Target = {
    pipeline: pickStr(pipeline),
    status: pickStr(status),
    pipelineStatusId: pickStr(pipelineStatusId),
    pipelineName: pickStr(pipelineName),
    statusName: pickStr(statusName),
  };
  return out.pipeline || out.status || out.pipelineName || out.statusName ? out : undefined;
}

function ensurePipelineStatus(target?: Target | null): Target | undefined {
  if (!target) return undefined;
  const pipelineStatusId = pickStr(target.pipelineStatusId);
  const status = pickStr(target.status);

  if (!pipelineStatusId && status) {
    return { ...target, pipelineStatusId: status };
  }

  return target;
}

function flattenTarget(prefix: 'base' | 't1' | 't2' | 'texp', target?: Target) {
  if (!target) return {};

  const mapKey = (suffix: string) => `${prefix === 't1' ? 'v1_to' : prefix === 't2' ? 'v2_to' : prefix}${suffix}`;

  const baseKey = prefix === 'base';

  const pipeline = pickStr(target.pipeline);
  const status = pickStr(target.status);
  const pipelineStatusId = pickStr(target.pipelineStatusId);
  const pipelineName = pickStr(target.pipelineName);
  const statusName = pickStr(target.statusName);

  const out: Record<string, string> = {};

  if (pipeline) {
    if (baseKey) out['base_pipeline_id'] = pipeline;
    else out[mapKey('_pipeline_id')] = pipeline;
  }

  if (status) {
    if (baseKey) out['base_status_id'] = status;
    else out[mapKey('_status_id')] = status;
  }

  if (pipelineStatusId) {
    if (baseKey) out['base_pipeline_status_id'] = pipelineStatusId;
    else out[mapKey('_pipeline_status_id')] = pipelineStatusId;
  }

  if (pipelineName) {
    if (baseKey) out['base_pipeline_name'] = pipelineName;
    else out[mapKey('_pipeline_name')] = pipelineName;
  }

  if (statusName) {
    if (baseKey) out['base_status_name'] = statusName;
    else out[mapKey('_status_name')] = statusName;
  }

  return out;
}

async function enrichNames(t?: Target) {
  if (!t) return t;
  const out = { ...t };
  try {
    if (out.pipeline && !out.pipelineName) {
      out.pipelineName = String(await getPipelineName(out.pipeline)) || out.pipelineName;
    }
  } catch {}
  try {
    if (out.pipeline && out.status && !out.statusName) {
      out.statusName = String(await getStatusName(out.pipeline, out.status)) || out.statusName;
    }
  } catch {}
  return out;
}

function meta(source: "kv" | "memory", count: number) {
  return {
    source,
    count,
    kvError: kvState.error?.message ?? null,
  };
}

// ---------- GET ----------
export async function GET() {
  const ids = await readIdsMerged();

  if (!ids.length) {
    return NextResponse.json({ ok: true, items: [], meta: meta(kvState.disabled ? "memory" : "kv", 0) });
  }

  const rawItems = await tryKv(() => kv.mget<(Campaign | null)[]>(...ids.map((id) => ITEM_KEY(id))));
  const out: Campaign[] = [];

  if (rawItems !== undefined) {
    rawItems.forEach((it) => {
      if (it && typeof it === "object") {
        const item = it as Campaign;
        out.push(item);
        memorySetItem(item.id, item);
      }
    });
  } else {
    memoryGetItems(ids).forEach((it) => {
      if (it) out.push(it);
    });
  }

  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return NextResponse.json({ ok: true, items: out, meta: meta(rawItems !== undefined ? "kv" : "memory", out.length) });
}

// ---------- POST ----------
export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  let body: any = {};
  if (ct.includes("application/json")) {
    try {
      body = await req.json();
    } catch {}
  } else {
    const fd = await req.formData().catch(() => null);
    fd?.forEach((v, k) => (body[k] = typeof v === "string" ? v : String(v)));
  }

  const now = Date.now();
  const id = String(now);
  const base = targetFromFlat(body, "base");
  const t1 = targetFromFlat(body, "t1");
  const t2 = targetFromFlat(body, "t2");
  const texp = targetFromFlat(body, "texp");

  const v1 = pickStr(body.v1);
  const v2 = pickStr(body.v2);

  // ⬇️ збираємо значення днів EXP з усіх можливих ключів форми
  const expDays =
    pickNum(body.expDays) ??
    pickNum(body.exp?.days) ??
    pickNum(body.exp) ??
    pickNum(body.exp_value) ??
    pickNum(body.expireDays) ??
    pickNum(body.expire) ??
    pickNum(body.vexp);

  // Обробляємо v1_condition та v2_condition з форми
  const v1Condition = body.v1_condition && typeof body.v1_condition === "object" ? body.v1_condition : null;
  const v2Condition = body.v2_condition && typeof body.v2_condition === "object" ? body.v2_condition : null;

  const rawRules = (body?.rules && typeof body.rules === "object") ? body.rules : null;
  // Парсимо правила з різних джерел: rules.v1, v1_condition, тощо
  const ruleV1 = parseRule(rawRules?.v1 ?? rawRules?.V1 ?? rawRules?.variant1 ?? v1Condition);
  const ruleV2 = parseRule(rawRules?.v2 ?? rawRules?.V2 ?? rawRules?.variant2 ?? v2Condition);

  const normalizedRules: Record<string, Rule> = {};
  if (ruleV1) normalizedRules.v1 = ruleV1;
  if (ruleV2) normalizedRules.v2 = ruleV2;

  const activeFlag =
    pickBool(body.active) ??
    pickBool(body.isActive) ??
    pickBool(body.enabled);

  const t1FromRule = targetFromRule(ruleV1);
  const t2FromRule = targetFromRule(ruleV2);
  const expFromRule = targetFromRule(parseRule(body.exp));

  const [eBase, e1, e2, eExp] = await Promise.all([
    enrichNames(base),
    enrichNames(t1 ?? t1FromRule),
    enrichNames(t2 ?? t2FromRule),
    enrichNames(texp ?? expFromRule),
  ]);

  const ruleValueV1 = ruleV1?.value ?? v1;
  const ruleValueV2 = ruleV2?.value ?? v2;

  // Перевірка унікальності V1/V2 перед створенням кампанії
  try {
    const { checkCampaignVUniqueness } = await import('@/lib/campaign-uniqueness');
    const uniquenessCheck = await checkCampaignVUniqueness(ruleValueV1, ruleValueV2);
    
    if (uniquenessCheck) {
      return NextResponse.json(
        {
          ok: false,
          error: uniquenessCheck.error,
          conflictingValue: uniquenessCheck.conflictingValue,
          conflictingCampaign: uniquenessCheck.conflictingCampaign,
        },
        { status: 400 }
      );
    }
  } catch (err) {
    // Якщо перевірка не вдалася - логуємо, але продовжуємо створення
    console.error('[campaigns] Failed to check V uniqueness:', err);
    // Не блокуємо створення кампанії через помилку перевірки
  }

  const campaign: Campaign = {
    id,
    name: pickStr(body.name) ?? "Без назви",
    base: ensurePipelineStatus(eBase),
    t1: ensurePipelineStatus(e1 ?? t1FromRule ?? undefined),
    t2: ensurePipelineStatus(e2 ?? t2FromRule ?? undefined),
    texp: ensurePipelineStatus(eExp ?? expFromRule ?? undefined),
    v1: ruleValueV1,
    v2: ruleValueV2,
    ...(Object.keys(normalizedRules).length ? { rules: normalizedRules } : {}),
    ...(expDays != null ? { expDays, exp: expDays } : {}), // збережемо ще й як `exp` для зручності рендеру
    counters: { v1: 0, v2: 0, exp: 0 },
    createdAt: now,
    ...(activeFlag !== undefined ? { active: activeFlag } : {}),
  };

  Object.assign(
    campaign,
    flattenTarget('base', campaign.base),
    flattenTarget('t1', campaign.t1),
    flattenTarget('t2', campaign.t2),
    flattenTarget('texp', campaign.texp),
  );

  // Ініціалізуємо статистику: підраховуємо картки в базовій воронці
  try {
    const { initializeCampaignStats } = await import('@/lib/campaign-stats');
    const campaignWithStats = await initializeCampaignStats(campaign);
    Object.assign(campaign, campaignWithStats);
  } catch (err) {
    // Якщо не вдалося підрахувати - встановлюємо 0
    campaign.baseCardsCount = 0;
    campaign.baseCardsCountUpdatedAt = Date.now();
    campaign.movedTotal = 0;
    campaign.movedV1 = 0;
    campaign.movedV2 = 0;
    campaign.movedExp = 0;
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[campaigns] Failed to initialize stats:', err);
    }
  }

  memorySetItem(id, campaign);
  await tryKv(() => kv.set(ITEM_KEY(id), campaign));
  await writeIdsMerged(id);

  return NextResponse.json(
    {
      ok: true,
      id,
      meta: meta(kvState.disabled ? "memory" : "kv", memoryReadIds().length),
    },
    { status: 201 }
  );
}
