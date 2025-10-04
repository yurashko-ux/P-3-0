// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getPipelineName, getStatusName } from "@/lib/keycrm";
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
  await kv.set(IDS_KEY, unique([newId, ...merged]));
}

const pickStr = (x: any) => (x==null?undefined: (String(x).trim()||undefined));
const pickNum = (x: any) => { const n=Number(x); return Number.isFinite(n)?n:undefined; };

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

  const now = Date.now(); const id = String(now);
  const base = targetFromFlat(body,"base");
  const t1   = targetFromFlat(body,"t1");
  const t2   = targetFromFlat(body,"t2");
  const texp = targetFromFlat(body,"texp");

  const v1 = pickStr(body.v1);
  const v2 = pickStr(body.v2);

  const normalizeDupValue = (value?: string | null) => {
    if (value == null) return undefined;
    const trimmed = String(value).trim();
    if (!trimmed) return undefined;
    return {
      raw: trimmed,
      normalized: trimmed.toLowerCase(),
    } as const;
  };

  const requestedValues = [v1, v2]
    .map((value) => normalizeDupValue(value))
    .filter((value): value is { raw: string; normalized: string } => Boolean(value?.normalized));

  if (requestedValues.length) {
    const ids = await readIdsMerged();
    if (ids.length) {
      const existing = new Set<string>();
      try {
        const items = await kv.mget(...ids.map((id) => ITEM_KEY(id)));
        const list = Array.isArray(items) ? items : [];
        for (const item of list) {
          if (item && typeof item === "object") {
            const campaignItem = item as Partial<Campaign>;
            const fromV1 = normalizeDupValue(campaignItem.v1);
            const fromV2 = normalizeDupValue(campaignItem.v2);
            if (fromV1) existing.add(fromV1.normalized);
            if (fromV2) existing.add(fromV2.normalized);
          }
        }
      } catch {}

      const conflict = requestedValues.find((value) => existing.has(value.normalized));
      if (conflict) {
        return NextResponse.json(
          { ok: false, error: `Конфлікт: значення «${conflict.raw}» вже використовується.` },
          { status: 409 },
        );
      }
    }
  }

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

  await kv.set(ITEM_KEY(id), campaign);
  await writeIdsMerged(id);

  return NextResponse.json({ ok:true, id }, { status: 201 });
}
