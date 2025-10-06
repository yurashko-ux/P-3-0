// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getPipelineName, getStatusName } from "@/lib/keycrm";
import { kvRead } from "@/lib/kv";
import {
  checkCampaignVariantsUniqueness,
  summarizeConflicts,
  type Campaign as UniqueCampaign,
  type CampaignRule as UniqueCampaignRule,
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

function normVariantValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  const str = String(value).trim();
  return str ? str : undefined;
}

function buildUniqueCampaignCandidate(
  raw: any,
  fallbackId: string
): UniqueCampaign {
  const id = String(raw?.id ?? fallbackId ?? "").trim();
  const v1 =
    normVariantValue(raw?.rules?.v1?.value) ??
    normVariantValue((raw?.rules?.v1 as any)?.value) ??
    normVariantValue(raw?.rules?.v1) ??
    normVariantValue(raw?.v1);
  const v2 =
    normVariantValue(raw?.rules?.v2?.value) ??
    normVariantValue((raw?.rules?.v2 as any)?.value) ??
    normVariantValue(raw?.rules?.v2) ??
    normVariantValue(raw?.v2);

  const out: UniqueCampaign = { id };
  const rules: { v1?: UniqueCampaignRule; v2?: UniqueCampaignRule } = {};
  if (v1) {
    rules.v1 = { op: "equals", value: v1 };
  }
  if (v2) {
    rules.v2 = { op: "equals", value: v2 };
  }
  if (rules.v1 || rules.v2) out.rules = rules;
  return out;
}

function parseStoredCampaign(raw: unknown, fallbackId: string): (Campaign & { id: string }) | null {
  if (!raw) return null;
  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const id = String(obj.id ?? fallbackId ?? "").trim();
  if (!id) return null;
  obj.id = id;
  return obj as Campaign & { id: string };
}

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

  // ⬇️ збираємо значення днів EXP з усіх можливих ключів форми
  const expDays =
    pickNum(body.expDays) ??
    pickNum(body.exp) ??
    pickNum(body.exp_value) ??
    pickNum(body.expireDays) ??
    pickNum(body.expire) ??
    pickNum(body.vexp);

  const [eBase,e1,e2,eExp] = await Promise.all([enrichNames(base),enrichNames(t1),enrichNames(t2),enrichNames(texp)]);

  if (v1 && v2 && v1.toLowerCase() === v2.toLowerCase()) {
    return NextResponse.json(
      {
        ok: false,
        error: "variant_conflict_same_campaign",
        message: "Значення V1 і V2 не можуть збігатися в одній кампанії. Оберіть інші значення V1 чи V2.",
      },
      { status: 409 }
    );
  }

  const candidateVariants = buildUniqueCampaignCandidate({ id, v1, v2 }, id);
  if (candidateVariants.rules) {
    const existingIds = (await readIdsMerged()).filter((storedId) => storedId !== id);
    const stored = existingIds.length
      ? await kv
          .mget(...existingIds.map((storedId) => ITEM_KEY(storedId)))
          .catch(() => [])
      : [];

    const meta = new Map<string, { name?: string }>();
    const others: UniqueCampaign[] = [];

    stored.forEach((raw, idx) => {
      const fallbackId = existingIds[idx];
      const parsed = parseStoredCampaign(raw, fallbackId);
      if (!parsed) return;
      meta.set(parsed.id, { name: parsed.name });
      const normalized = buildUniqueCampaignCandidate(parsed, parsed.id);
      if (normalized.rules) {
        others.push(normalized);
      }
    });

    try {
      const modern = (await kvRead.listCampaigns().catch(() => [])) as any[];
      modern.forEach((raw) => {
        const parsed = parseStoredCampaign(raw, String(raw?.id ?? ""));
        if (!parsed) return;
        if (parsed.id === id) return;
        if (meta.has(parsed.id)) return;
        meta.set(parsed.id, { name: parsed.name });
        const normalized = buildUniqueCampaignCandidate(parsed, parsed.id);
        if (normalized.rules) {
          others.push(normalized);
        }
      });
    } catch {}

    const uniqueness = checkCampaignVariantsUniqueness(candidateVariants, others);
    if (uniqueness.ok === false) {
      const conflicts = uniqueness.conflicts ?? [];
      const readable = conflicts.map((conf) => {
        const variantLabel = conf.which === "v1" ? "V1" : "V2";
        const originalValue = conf.which === "v1" ? v1 : v2;
        const val = originalValue || conf.value;
        const other = meta.get(String(conf.campaignId));
        const campaignLabel = other?.name
          ? `кампанії “${other.name}”`
          : `кампанії #${conf.campaignId}`;
        return `${variantLabel} "${val}" (${campaignLabel})`;
      });
      const message =
        readable.length > 0
          ? `Значення ${readable.join(", ")} вже використовуються в інших кампаніях. Оберіть інші значення V1 чи V2.`
          : "Ці значення вже використовуються в іншій кампанії. Оберіть інші значення V1 чи V2.";

      return NextResponse.json(
        {
          ok: false,
          error: "variant_conflict",
          message,
          conflicts,
          details: summarizeConflicts(uniqueness),
        },
        { status: 409 }
      );
    }
  }

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
