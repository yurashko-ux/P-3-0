// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getPipelineName, getStatusName } from "@/lib/keycrm";
import { kvRead, kvWrite } from "@/lib/kv";
import {
  normalizeCandidate,
  collectRuleSummaries,
  type CampaignLike,
  type RuleSummary as CampaignRuleSummary,
} from "@/lib/campaign-rules";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

type Target = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
type Counters = { v1: number; v2: number; exp: number };
type RuleMatch = { slot: "v1" | "v2"; value: string };

type Campaign = {
  id: string;
  name: string;
  base?: Target;
  t1?: Target;
  t2?: Target;
  texp?: Target;
  v1?: string;
  v2?: string;
  expDays?: number;
  expireDays?: number;
  expire?: number;
  vexp?: number;
  exp?: number;
  counters?: Counters;
  createdAt?: number;
  active?: boolean;
  deleted?: boolean;
  __index_id?: string;
  rules?: Record<string, any> | null;
  rulesNormalized?: { v1?: CampaignRuleSummary | null; v2?: CampaignRuleSummary | null };
  ruleMatches?: RuleMatch[];
};

const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

const WRONGTYPE_RE = /WRONGTYPE/i;

async function readIndexList(): Promise<string[]> {
  try {
    const list = await kv.lrange<string>(IDS_KEY, 0, -1);
    if (Array.isArray(list)) {
      return list.map((value) => String(value)).filter(Boolean);
    }
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? '';
    if (!WRONGTYPE_RE.test(message)) {
      return [];
    }

    const stored = await kv.get<string[] | null>(IDS_KEY).catch(() => null);
    const recovered = Array.isArray(stored)
      ? stored.map((value) => String(value)).filter(Boolean)
      : [];

    if (recovered.length) {
      await kv.del(IDS_KEY).catch(() => {});
      await kv.rpush(IDS_KEY, ...recovered).catch(() => {});
      return recovered;
    }

    await kv.del(IDS_KEY).catch(() => {});
    return [];
  }

  return [];
}

async function readIdsMerged(): Promise<string[]> {
  const [list, stored] = await Promise.all([
    readIndexList(),
    kv.get<string[] | null>(IDS_KEY).catch(() => null),
  ]);

  const fromStored = Array.isArray(stored)
    ? stored.map((value) => String(value)).filter(Boolean)
    : [];

  return unique([...fromStored, ...list]);
}

async function writeIdsMerged(newId: string) {
  const id = pickStr(newId);
  if (!id) return;

  const existing = await readIdsMerged();
  if (existing.includes(id)) return;

  try {
    await kv.lpush(IDS_KEY, id);
    return;
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? '';
    if (!WRONGTYPE_RE.test(message)) {
      return;
    }
  }

  const recovered = await readIndexList();
  if (!recovered.includes(id)) recovered.unshift(id);
  await kv.del(IDS_KEY).catch(() => {});
  if (recovered.length) {
    await kv.rpush(IDS_KEY, ...recovered).catch(() => {});
  }
}

const pickStr = (x: any) => (x==null?undefined: (String(x).trim()||undefined));
const pickNum = (x: any) => { const n=Number(x); return Number.isFinite(n)?n:undefined; };

const TRUE_STRINGS = new Set(['1','true','yes','on','active','enabled']);
const FALSE_STRINGS = new Set(['0','false','no','off','inactive','disabled']);

function parseFlag(value: any, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    if (value === 0) return false;
    if (value === 1) return true;
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (TRUE_STRINGS.has(normalized)) return true;
    if (FALSE_STRINGS.has(normalized)) return false;
    return fallback;
  }

  return fallback;
}

function targetFromFlat(src: Record<string, any>, prefix: string): Target | undefined {
  const get = (...ks: string[]) => ks.map(k => src[k]).find(v => v!=null);
  const pipeline = get(`${prefix}.pipeline`,`${prefix}_pipeline`,`${prefix}Pipeline`) ?? src[prefix]?.pipeline;
  const status   = get(`${prefix}.status`,`${prefix}_status`,`${prefix}Status`) ?? src[prefix]?.status;
  const pipelineName = get(`${prefix}.pipelineName`,`${prefix}_pipelineName`,`${prefix}PipelineName`) ?? src[prefix]?.pipelineName;
  const statusName   = get(`${prefix}.statusName`,`${prefix}_statusName`,`${prefix}StatusName`)   ?? src[prefix]?.statusName;
  const out: Target = {
    pipeline: pickStr(pipeline), status: pickStr(status),
    pipelineName: pickStr(pipelineName), statusName: pickStr(statusName),
  };
  return (out.pipeline||out.status||out.pipelineName||out.statusName) ? out : undefined;
}

async function enrichNames(t?: Target){ if(!t) return t; const out={...t};
  try{ if(out.pipeline && !out.pipelineName) out.pipelineName = String(await getPipelineName(out.pipeline)) || out.pipelineName; }catch{}
  try{ if(out.pipeline && out.status && !out.statusName) out.statusName = String(await getStatusName(out.pipeline,out.status)) || out.statusName; }catch{}
  return out;
}

type Slot = "base" | "t1" | "t2" | "texp";

const SLOT_VARIANTS: Record<Slot, string[]> = {
  base: ["base", "Base", "BASE", "source", "Source", "SOURCE", "start", "Start", "START", "default", "Default"],
  t1: ["t1", "T1", "target1", "Target1", "TARGET1", "route1", "Route1", "ROUTE1", "v1", "V1"],
  t2: ["t2", "T2", "target2", "Target2", "TARGET2", "route2", "Route2", "ROUTE2", "v2", "V2"],
  texp: [
    "texp",
    "TEXP",
    "target_exp",
    "Target_exp",
    "TARGET_EXP",
    "targetExp",
    "TargetExp",
    "TARGETEXP",
    "exp",
    "Exp",
    "EXP",
    "vexp",
    "Vexp",
    "VEXP",
  ],
};

const DIRECT_ID_SUFFIXES = {
  pipeline: ["_pipeline_id", "_pipeline", "_pipelineId", "PipelineId", "Pipeline", "PipelineID", "Pipeline_id"],
  status: ["_status_id", "_status", "_statusId", "StatusId", "Status", "StatusID", "Status_id"],
};

const DIRECT_NAME_SUFFIXES = {
  pipeline: ["_pipeline_name", "_pipelineLabel", "_pipelineTitle", "_pipelineName", "PipelineName", "PipelineLabel", "PipelineTitle"],
  status: ["_status_name", "_statusLabel", "_statusTitle", "_statusName", "StatusName", "StatusLabel", "StatusTitle"],
};

const CANDIDATE_ID_ATTRS = {
  pipeline: ["pipeline_id", "pipeline", "pipelineId", "pipelineID", "id", "value", "pipelineCode", "pipeline_code", "code"],
  status: ["status_id", "status", "statusId", "statusID", "id", "value", "statusCode", "status_code", "code"],
};

const CANDIDATE_NAME_ATTRS = {
  pipeline: ["pipeline_name", "pipelineName", "pipelineTitle", "pipelineLabel", "title", "label", "name"],
  status: ["status_name", "statusName", "statusTitle", "statusLabel", "title", "label", "name"],
};

function uniqStrings(values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value) return value;
  }
  return undefined;
}

function collectTargetCandidates(src: Record<string, any>, slot: Slot): any[] {
  const variants = SLOT_VARIANTS[slot] || [];
  const seen = new Set<object>();
  const queue: object[] = [];

  const push = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    queue.push(value);
  };

  const addByKey = (key: string) => {
    push(src[key]);
    push(src[`${key}Target`]);
    push(src[`${key}_target`]);
    push(src[`${key}Preset`]);
    push(src[`${key}_preset`]);
    push(src[`${key}Route`]);
    push(src[`${key}_route`]);
  };

  for (const key of variants) {
    addByKey(key);
    addByKey(key.toLowerCase());
    addByKey(key.toUpperCase());
    if (key.length > 0) {
      const capital = key.charAt(0).toUpperCase() + key.slice(1);
      addByKey(capital);
    }
    push(src.targets?.[key]);
    push(src.targets?.[key.toLowerCase?.() ?? key]);
    push(src.targets?.[key.toUpperCase?.() ?? key]);
    push(src.routes?.[key]);
    push(src.routes?.[key.toLowerCase?.() ?? key]);
    push(src.routes?.[key.toUpperCase?.() ?? key]);
  }

  if (slot === "t1") {
    push(src.routes?.v1);
    push(src.routes?.V1);
    push(src.targets?.v1);
    push(src.targets?.V1);
  } else if (slot === "t2") {
    push(src.routes?.v2);
    push(src.routes?.V2);
    push(src.targets?.v2);
    push(src.targets?.V2);
  } else if (slot === "texp") {
    push(src.routes?.exp);
    push(src.routes?.Exp);
    push(src.routes?.EXP);
    push(src.routes?.texp);
    push(src.routes?.TEXP);
    push(src.targets?.exp);
    push(src.targets?.Exp);
    push(src.targets?.texp);
    push(src.targets?.TEXP);
  } else if (slot === "base") {
    push(src.routes?.base);
    push(src.targets?.base);
  }

  const out: object[] = [];
  while (queue.length) {
    const obj = queue.shift()!;
    out.push(obj);
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        if (!seen.has(value as object)) {
          seen.add(value as object);
          queue.push(value as object);
        }
      }
    }
  }

  return out;
}

function pickFromDirectFields(src: Record<string, any>, variants: string[], suffixes: string[]): string | undefined {
  for (const key of variants) {
    for (const suffix of suffixes) {
      const value = pickStr(src[`${key}${suffix}`]);
      if (value) return value;
      const altValue = pickStr(src[`${key}${suffix.replace(/^_/, "").replace(/_(.)/g, (_, c) => c.toUpperCase())}`]);
      if (altValue) return altValue;
    }
  }
  return undefined;
}

function pickFromCandidates(candidates: any[], attrs: string[]): string | undefined {
  const seen = new Set<any>();
  const queue: any[] = [];
  for (const cand of candidates) {
    if (cand && typeof cand === "object" && !seen.has(cand)) {
      seen.add(cand);
      queue.push(cand);
    }
  }
  while (queue.length) {
    const cand = queue.shift();
    if (!cand || typeof cand !== "object") continue;
    for (const attr of attrs) {
      const value = pickStr((cand as any)[attr]);
      if (value) return value;
    }
    for (const value of Object.values(cand)) {
      if (value && typeof value === "object" && !seen.has(value)) {
        seen.add(value);
        queue.push(value);
      }
    }
  }
  return undefined;
}

function deriveTarget(src: Record<string, any>, slot: Slot): Target | undefined {
  const variants = SLOT_VARIANTS[slot] || [];
  if (!variants.length) return undefined;

  const candidates = collectTargetCandidates(src, slot);

  const pipeline = uniqStrings([
    pickFromDirectFields(src, variants, DIRECT_ID_SUFFIXES.pipeline),
    pickFromCandidates(candidates, CANDIDATE_ID_ATTRS.pipeline),
  ]);

  const status = uniqStrings([
    pickFromDirectFields(src, variants, DIRECT_ID_SUFFIXES.status),
    pickFromCandidates(candidates, CANDIDATE_ID_ATTRS.status),
  ]);

  const pipelineName = uniqStrings([
    pickFromDirectFields(src, variants, DIRECT_NAME_SUFFIXES.pipeline),
    pickFromCandidates(candidates, CANDIDATE_NAME_ATTRS.pipeline),
  ]);

  const statusName = uniqStrings([
    pickFromDirectFields(src, variants, DIRECT_NAME_SUFFIXES.status),
    pickFromCandidates(candidates, CANDIDATE_NAME_ATTRS.status),
  ]);

  if (!pipeline && !status && !pipelineName && !statusName) return undefined;
  return { pipeline, status, pipelineName, statusName };
}

async function normalizeTarget(src: Record<string, any>, slot: Slot): Promise<Target | undefined> {
  const rough = deriveTarget(src, slot);
  return enrichNames(rough);
}

const slotsFromParams = (params: URLSearchParams): ("v1" | "v2")[] => {
  const requested = params.getAll("slot").map((s) => s?.trim().toLowerCase());
  const normalized = requested
    .filter((s): s is "v1" | "v2" => s === "v1" || s === "v2")
    .slice(0, 2);
  if (normalized.length) return normalized;
  const single = params.get("slot")?.trim().toLowerCase();
  if (single === "v1" || single === "v2") return [single];
  return ["v1", "v2"];
};

const collectRuleStrings = (raw: CampaignLike, slot: "v1" | "v2"): string[] =>
  collectRuleSummaries(raw, slot).map((rule) => normalizeCandidate(rule.value).trim()).filter(Boolean);

const ruleMatchesCacheKey = (raw: Record<string, any>) =>
  pickStr(raw?.id) || pickStr(raw?.__index_id) || "";

// ---------- GET ----------
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const rawCampaigns = (await kvRead.listCampaigns<Record<string, any>>()) ?? [];
  if (!rawCampaigns.length) {
    return NextResponse.json<Campaign[]>([]);
  }

  const needleRaw =
    params.get("value") ??
    params.get("rule") ??
    params.get("q") ??
    params.get("needle") ??
    "";
  const needle = normalizeCandidate(needleRaw).trim();
  const matchMode = (params.get("match") || "contains").trim().toLowerCase();
  const mode: "contains" | "equals" = matchMode === "equals" || matchMode === "equal" ? "equals" : "contains";
  const activeOnly = (params.get("active") || "").trim().toLowerCase() === "true";
  const slots = slotsFromParams(params);

  const matchesById = new Map<string, RuleMatch[]>();

  let filtered = rawCampaigns;
  if (activeOnly) {
    filtered = filtered.filter((raw) => raw?.active !== false);
  }

  if (needle) {
    const needleLow = needle.toLowerCase();
    filtered = filtered.filter((raw) => {
      const matches: RuleMatch[] = [];
      for (const slot of slots) {
        const values = collectRuleStrings(raw as CampaignLike, slot);
        for (const value of values) {
          const valueLow = value.toLowerCase();
          const matched = mode === "equals" ? valueLow === needleLow : valueLow.includes(needleLow);
          if (matched) {
            matches.push({ slot, value });
            break;
          }
        }
      }
      if (!matches.length) return false;
      const key = ruleMatchesCacheKey(raw);
      if (key) matchesById.set(key, matches);
      return true;
    });
  }

  const normalized: Campaign[] = [];

  for (const raw of filtered) {
    const id = pickStr(raw?.id) || pickStr(raw?.__index_id);
    if (!id) continue;

    const name = pickStr(raw?.name) || pickStr(raw?.title) || `#${id}`;
    const createdAt =
      pickNum(raw?.created_at) ||
      pickNum(raw?.createdAt) ||
      pickNum(raw?.created) ||
      (Number(id) && Number.isFinite(Number(id)) ? Number(id) : undefined);

    const [base, t1, t2, texp] = await Promise.all([
      normalizeTarget(raw, "base"),
      normalizeTarget(raw, "t1"),
      normalizeTarget(raw, "t2"),
      normalizeTarget(raw, "texp"),
    ]);

    const counters: Counters = {
      v1: Number(raw?.v1_count ?? raw?.counters?.v1 ?? 0) || 0,
      v2: Number(raw?.v2_count ?? raw?.counters?.v2 ?? 0) || 0,
      exp: Number(raw?.exp_count ?? raw?.counters?.exp ?? 0) || 0,
    };

    const expDays =
      pickNum(raw?.expDays) ??
      pickNum(raw?.exp) ??
      pickNum(raw?.exp_value) ??
      pickNum(raw?.expireDays) ??
      pickNum(raw?.expire) ??
      pickNum(raw?.vexp);

    const [ruleV1] = collectRuleSummaries(raw as CampaignLike, "v1");
    const [ruleV2] = collectRuleSummaries(raw as CampaignLike, "v2");

    normalized.push({
      id,
      __index_id: pickStr(raw?.__index_id),
      name,
      active: raw?.active !== false,
      base,
      t1,
      t2,
      texp,
      v1: pickStr(raw?.v1) ?? pickStr(raw?.rules?.v1) ?? pickStr(raw?.v1_rule),
      v2: pickStr(raw?.v2) ?? pickStr(raw?.rules?.v2) ?? pickStr(raw?.v2_rule),
      expDays,
      exp: expDays,
      counters,
      createdAt,
      rules: raw?.rules ?? null,
      rulesNormalized: {
        v1: ruleV1 ?? null,
        v2: ruleV2 ?? null,
      },
      ruleMatches: matchesById.get(id),
    });
  }

  normalized.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const response = NextResponse.json(normalized);
  response.headers.set("x-total-campaigns", String(rawCampaigns.length));
  response.headers.set("x-total-returned", String(normalized.length));
  if (needle) {
    response.headers.set("x-rule-needle", needle);
    response.headers.set("x-rule-mode", mode);
    response.headers.set("x-rule-slots", slots.join(","));
  }
  if (activeOnly) {
    response.headers.set("x-active-only", "true");
  }
  return response;
}

// ---------- POST ----------
export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  let body: any = {};
  if (ct.includes("application/json")) { try { body = await req.json(); } catch {} }
  else { const fd = await req.formData().catch(()=>null); fd?.forEach((v,k)=> body[k]= typeof v==="string"? v:String(v)); }

  const now = Date.now(); const id = String(now);
  const base = targetFromFlat(body,"base");
  const t1   = targetFromFlat(body,"t1");
  const t2   = targetFromFlat(body,"t2");
  const texp = targetFromFlat(body,"texp");

  const v1 = pickStr(body.v1);
  const v2 = pickStr(body.v2);

  const rawRules = body && typeof body.rules === "object" && body.rules ? (body.rules as Record<string, any>) : undefined;
  const rawExpConfig = body && typeof body.exp === "object" && body.exp ? (body.exp as Record<string, any>) : undefined;

  // ⬇️ збираємо значення днів EXP з усіх можливих ключів форми
  const expDays =
    pickNum(body.expDays) ??
    pickNum(body.exp) ??
    pickNum(body.exp_value) ??
    pickNum(body.expireDays) ??
    pickNum(body.expire) ??
    pickNum(body.vexp);

  const [eBase,e1,e2,eExp] = await Promise.all([enrichNames(base),enrichNames(t1),enrichNames(t2),enrichNames(texp)]);

  const isDeleted = parseFlag(body.deleted, false);
  const isActive = isDeleted ? false : parseFlag(body.active, true);

  const campaign: Campaign = {
    id, name: pickStr(body.name) ?? "Без назви",
    base: eBase, t1: e1, t2: e2, texp: eExp, v1, v2,
    ...(expDays!=null ? { expDays, exp: expDays } : {}), // збережемо ще й як `exp` для зручності рендеру
    counters: { v1:0, v2:0, exp:0 }, createdAt: now,
    active: isActive,
    deleted: isDeleted,
  };

  if (rawRules) {
    campaign.rules = rawRules;
  }
  if (rawExpConfig) {
    (campaign as any).expConfig = rawExpConfig;
  }

  const ruleSummaries = {
    v1: collectRuleSummaries({ ...campaign, rules: rawRules ?? undefined }, "v1")[0] ?? null,
    v2: collectRuleSummaries({ ...campaign, rules: rawRules ?? undefined }, "v2")[0] ?? null,
  };
  campaign.rulesNormalized = {
    v1: ruleSummaries.v1,
    v2: ruleSummaries.v2,
  };

  const normalizedIncoming = {
    v1: ruleSummaries.v1?.value ? {
      raw: ruleSummaries.v1.value,
      lower: ruleSummaries.v1.value.toLowerCase(),
    } : null,
    v2: ruleSummaries.v2?.value ? {
      raw: ruleSummaries.v2.value,
      lower: ruleSummaries.v2.value.toLowerCase(),
    } : null,
  } as const;

  if (
    normalizedIncoming.v1 &&
    normalizedIncoming.v2 &&
    normalizedIncoming.v1.lower === normalizedIncoming.v2.lower
  ) {
    return NextResponse.json(
      { ok: false, error: 'Значення V1 і V2 мають бути різними' },
      { status: 409 },
    );
  }

  if (normalizedIncoming.v1 || normalizedIncoming.v2) {
    const existing = await kvRead.listCampaigns<CampaignLike>();
    type Conflict = {
      incoming: 'v1' | 'v2';
      existingSlot: 'v1' | 'v2';
      value: string;
      campaign: { id: string; name?: string };
    };
    const conflicts: Conflict[] = [];

    const checkValue = (
      incoming: 'v1' | 'v2',
      needleLower: string,
      needleRaw: string,
    ) => {
      for (const item of existing) {
        if (!item || typeof item !== 'object') continue;
        const candidateId = pickStr((item as any)?.id) ?? pickStr((item as any)?.__index_id);
        const campaignId = candidateId ?? '[невідомо]';
        if (campaignId === id) continue;
        const campaignName = pickStr((item as any)?.name) ?? campaignId;
        const isDeleted = !!(item as any)?.deleted;
        if (isDeleted) continue;

        for (const existingSlot of ['v1', 'v2'] as const) {
          const summaries = collectRuleSummaries(item as CampaignLike, existingSlot);
          for (const summary of summaries) {
            if (summary.value.toLowerCase() === needleLower) {
              conflicts.push({
                incoming,
                existingSlot,
                value: needleRaw,
                campaign: { id: campaignId, name: campaignName },
              });
              break;
            }
          }
        }
      }
    };

    if (normalizedIncoming.v1) {
      checkValue('v1', normalizedIncoming.v1.lower, normalizedIncoming.v1.raw);
    }
    if (normalizedIncoming.v2) {
      checkValue('v2', normalizedIncoming.v2.lower, normalizedIncoming.v2.raw);
    }

    if (conflicts.length) {
      const message = conflicts
        .map((conflict) => {
          const incomingLabel = conflict.incoming === 'v1' ? 'V1' : 'V2';
          const existingLabel = conflict.existingSlot === 'v1' ? 'V1' : 'V2';
          const name = conflict.campaign.name ?? conflict.campaign.id;
          return `${incomingLabel} "${conflict.value}" вже використовується як ${existingLabel} у кампанії "${name}" (#${conflict.campaign.id})`;
        })
        .join('; ');

      return NextResponse.json(
        { ok: false, error: `Конфлікт значень: ${message}` },
        { status: 409 },
      );
    }
  }

  const serialized = JSON.stringify(campaign);

  let stored = false;
  try {
    await kv.set(ITEM_KEY(id), campaign);
    stored = true;
  } catch (error) {
    console.warn("[campaigns] kv.set failed, falling back to raw set", error);
  }
  if (!stored) {
    try {
      await kvWrite.setRaw(ITEM_KEY(id), serialized);
      stored = true;
    } catch (error) {
      console.error("[campaigns] kvWrite.setRaw failed", error);
    }
  }
  if (!stored) {
    return NextResponse.json({ ok: false, error: "Не вдалося зберегти кампанію" }, { status: 500 });
  }

  let indexed = false;
  try {
    await kv.lpush(IDS_KEY, id);
    indexed = true;
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? "";
    if (!WRONGTYPE_RE.test(message)) {
      console.warn("[campaigns] kv.lpush failed, will fallback", error);
    } else {
      console.warn("[campaigns] kv.lpush wrongtype, will rebuild", error);
    }
  }
  if (!indexed) {
    try {
      await kvWrite.lpush(IDS_KEY, id);
      indexed = true;
    } catch (error) {
      console.error("[campaigns] kvWrite.lpush failed", error);
    }
  }
  if (!indexed) {
    await writeIdsMerged(id);
  }

  return NextResponse.json({ ok:true, id }, { status: 201 });
}
