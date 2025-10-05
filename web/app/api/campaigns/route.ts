// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getPipelineName, getStatusName } from "@/lib/keycrm";
import {
  checkCampaignVariantsUniqueness,
  summarizeConflicts,
  type Campaign as UniqueCampaign,
} from "@/lib/campaigns-unique";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

type Target = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
type Counters = { v1: number; v2: number; exp: number };
type Campaign = {
  id: string; name: string; base?: Target; t1?: Target; t2?: Target; texp?: Target;
  v1?: string; v2?: string;
  expDays?: number; expireDays?: number; expire?: number; vexp?: number; exp?: number; // ⬅️ додав exp
  counters: Counters; createdAt: number;
};

const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

async function readIdsMerged(): Promise<string[]> {
  const arr = (await kv.get<string[] | null>(IDS_KEY)) ?? [];
  let list: string[] = [];
  try { list = await kv.lrange<string>(IDS_KEY, 0, -1); } catch {}
  return unique([...(Array.isArray(arr)?arr:[]), ...(Array.isArray(list)?list:[])]);
}
async function writeIdsMerged(newId: string) {
  const merged = await readIdsMerged();
  if (merged.includes(newId)) {
    await kv.set(IDS_KEY, merged);
    return;
  }
  await kv.set(IDS_KEY, unique([newId, ...merged]));
}

async function readAllCampaigns(): Promise<Campaign[]> {
  const ids = await readIdsMerged();
  if (!ids.length) return [];
  const items = await kv.mget<(Campaign | null)[]>(...ids.map((id) => ITEM_KEY(id)));
  const out: Campaign[] = [];
  items.forEach((it) => {
    if (it && typeof it === "object") out.push(it as Campaign);
  });
  return out;
}

const pickStr = (x: any) => (x==null?undefined: (String(x).trim()||undefined));
const pickNum = (x: any) => { const n=Number(x); return Number.isFinite(n)?n:undefined; };

const pickVariantValue = (src: Record<string, any>, key: "v1" | "v2") => {
  const rule = src?.rules?.[key];
  if (rule && typeof rule === "object") {
    const val = pickStr(rule.value);
    if (val) return val;
  }
  const cond = src?.[`${key}_condition`];
  if (cond && typeof cond === "object") {
    const val = pickStr(cond.value);
    if (val) return val;
  }
  const direct = src?.[key];
  if (direct && typeof direct === "object") {
    const val = pickStr((direct as any).value);
    if (val) return val;
  }
  const candidates = [
    src?.[`${key}_value`],
    src?.[`${key}Value`],
    direct,
  ];
  for (const cand of candidates) {
    if (cand == null || typeof cand === "object") continue;
    const val = pickStr(cand);
    if (val) return val;
  }
  return undefined;
};

function toUniqueCampaignShape(raw: any): UniqueCampaign {
  const rawId =
    raw?.id ??
    raw?.campaignId ??
    raw?.campaign_id ??
    raw?.ID ??
    raw?.Id ??
    raw?.uuid ??
    raw?.uid;
  const id =
    typeof rawId === "number"
      ? rawId
      : typeof rawId === "string" && rawId.trim()
      ? rawId.trim()
      : rawId != null
      ? String(rawId)
      : "unknown";

  const v1 = pickVariantValue(raw, "v1");
  const v2 = pickVariantValue(raw, "v2");

  const rules: UniqueCampaign["rules"] = {};
  if (v1) rules.v1 = { op: raw?.rules?.v1?.op ?? "equals", value: v1 };
  if (v2) rules.v2 = { op: raw?.rules?.v2?.op ?? "equals", value: v2 };

  const shaped: UniqueCampaign = { id, name: raw?.name };
  if (rules.v1 || rules.v2) shaped.rules = rules;
  return shaped;
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

// ---------- GET ----------
export async function GET() {
  const ids = await readIdsMerged();
  if (!ids.length) return NextResponse.json<Campaign[]>([]);
  const items = await kv.mget<(Campaign|null)[]>(...ids.map((id)=>ITEM_KEY(id)));
  const out: Campaign[] = [];
  items.forEach((it)=> it && typeof it==="object" && out.push(it as Campaign));
  out.sort((a,b)=> (b.createdAt??0)-(a.createdAt??0));
  return NextResponse.json(out);
}

// ---------- POST ----------
export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  let body: any = {};
  if (ct.includes("application/json")) { try { body = await req.json(); } catch {} }
  else { const fd = await req.formData().catch(()=>null); fd?.forEach((v,k)=> body[k]= typeof v==="string"? v:String(v)); }

  const now = Date.now();
  const providedId =
    pickStr(body.id) ??
    pickStr(body.ID) ??
    pickStr(body.campaignId) ??
    pickStr(body.campaign_id);
  const id = providedId ?? String(now);
  const base = targetFromFlat(body,"base");
  const t1   = targetFromFlat(body,"t1");
  const t2   = targetFromFlat(body,"t2");
  const texp = targetFromFlat(body,"texp");

  const v1 = pickVariantValue(body, "v1");
  const v2 = pickVariantValue(body, "v2");

  // ⬇️ збираємо значення днів EXP з усіх можливих ключів форми
  const expDays =
    pickNum(body.expDays) ??
    pickNum(body.exp) ??
    pickNum(body.exp_value) ??
    pickNum(body.expireDays) ??
    pickNum(body.expire) ??
    pickNum(body.vexp);

  const [eBase,e1,e2,eExp] = await Promise.all([enrichNames(base),enrichNames(t1),enrichNames(t2),enrichNames(texp)]);

  const campaign: Campaign = {
    id, name: pickStr(body.name) ?? "Без назви",
    base: eBase, t1: e1, t2: e2, texp: eExp, v1, v2,
    ...(expDays!=null ? { expDays, exp: expDays } : {}), // збережемо ще й як `exp` для зручності рендеру
    counters: { v1:0, v2:0, exp:0 }, createdAt: now
  };

  const existing = await readAllCampaigns();
  const candidateUnique = toUniqueCampaignShape({ ...campaign, rules: body?.rules });
  const candidateIdStr = String(candidateUnique.id ?? "");
  const othersUnique = existing
    .map((it) => toUniqueCampaignShape(it))
    .filter((it) => String(it.id ?? "") !== candidateIdStr);
  const uniqueness = checkCampaignVariantsUniqueness(candidateUnique, othersUnique);
  if (!uniqueness.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "variants_conflict",
        message: summarizeConflicts(uniqueness),
        conflicts: uniqueness.conflicts,
      },
      { status: 409 }
    );
  }

  await kv.set(ITEM_KEY(id), campaign);
  await writeIdsMerged(id);

  return NextResponse.json({ ok:true, id }, { status: 201 });
}
