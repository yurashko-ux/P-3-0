// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getPipelineName, getStatusName } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
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
      const value = await kv.lrange<string>(IDS_KEY, 0, -1);
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

  const rawRules = (body?.rules && typeof body.rules === "object") ? body.rules : null;
  const ruleV1 = parseRule(rawRules?.v1 ?? rawRules?.V1 ?? rawRules?.variant1);
  const ruleV2 = parseRule(rawRules?.v2 ?? rawRules?.V2 ?? rawRules?.variant2);

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

  const campaign: Campaign = {
    id,
    name: pickStr(body.name) ?? "Без назви",
    base: eBase,
    t1: e1 ?? t1FromRule ?? undefined,
    t2: e2 ?? t2FromRule ?? undefined,
    texp: eExp ?? expFromRule ?? undefined,
    v1: ruleValueV1,
    v2: ruleValueV2,
    ...(Object.keys(normalizedRules).length ? { rules: normalizedRules } : {}),
    ...(expDays != null ? { expDays, exp: expDays } : {}), // збережемо ще й як `exp` для зручності рендеру
    counters: { v1: 0, v2: 0, exp: 0 },
    createdAt: now,
    ...(activeFlag !== undefined ? { active: activeFlag } : {}),
  };

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
