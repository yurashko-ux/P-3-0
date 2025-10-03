// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getPipelineName, getStatusName } from "@/lib/keycrm"; // не падатиме, якщо токен не валідний — ми зловимо
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

// ---- types (мʼякі) ----
type Target = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
type Counters = { v1: number; v2: number; exp: number };
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
  counters: Counters;
  createdAt: number;
};

// ---------- helpers ----------
async function readIds(): Promise<string[]> {
  const arr = await kv.get<string[] | null>(IDS_KEY);
  if (Array.isArray(arr) && arr.length) return arr.filter(Boolean);
  try {
    const list = await kv.lrange<string>(IDS_KEY, 0, -1);
    return Array.isArray(list) ? list.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function pickStr(x: any): string | undefined {
  if (x == null) return undefined;
  const s = String(x).trim();
  return s.length ? s : undefined;
}
function pickNum(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function targetFromFlat(src: Record<string, any>, prefix: string): Target | undefined {
  // підтримуємо: base.pipeline / base.status
  //              base_pipeline / base_status
  //              basePipeline / baseStatus
  const get = (...keys: string[]) =>
    keys.map((k) => src[k]).find((v) => v !== undefined && v !== null);

  const pipeline =
    get(`${prefix}.pipeline`, `${prefix}_pipeline`, `${prefix}Pipeline`) ??
    (src[prefix]?.pipeline as any);
  const status =
    get(`${prefix}.status`, `${prefix}_status`, `${prefix}Status`) ??
    (src[prefix]?.status as any);

  const pipelineName =
    get(`${prefix}.pipelineName`, `${prefix}_pipelineName`, `${prefix}PipelineName`) ??
    (src[prefix]?.pipelineName as any);
  const statusName =
    get(`${prefix}.statusName`, `${prefix}_statusName`, `${prefix}StatusName`) ??
    (src[prefix]?.statusName as any);

  const out: Target = {
    pipeline: pickStr(pipeline),
    status: pickStr(status),
    pipelineName: pickStr(pipelineName),
    statusName: pickStr(statusName),
  };
  if (!out.pipeline && !out.status && !out.pipelineName && !out.statusName) return undefined;
  return out;
}

async function enrichNames(t?: Target): Promise<Target | undefined> {
  if (!t) return t;
  const out: Target = { ...t };
  // лише якщо нема кешу — спробуємо KeyCRM; якщо кине 401/429 — мовчки лишимо як є
  try {
    if (out.pipeline && !out.pipelineName) {
      out.pipelineName = String(await getPipelineName(out.pipeline)).trim() || out.pipelineName;
    }
  } catch {}
  try {
    if (out.pipeline && out.status && !out.statusName) {
      out.statusName =
        String(await getStatusName(out.pipeline, out.status)).trim() || out.statusName;
    }
  } catch {}
  return out;
}

async function storeCampaign(c: Campaign) {
  await kv.set(ITEM_KEY(c.id), c);
  const ids = (await kv.get<string[] | null>(IDS_KEY)) ?? [];
  const next = Array.isArray(ids) ? [c.id, ...ids.filter(Boolean)] : [c.id];
  await kv.set(IDS_KEY, next);
}

// ---------- GET ----------
export async function GET() {
  const ids = await readIds();
  if (!ids.length) return NextResponse.json<Campaign[]>([]);
  const items = await kv.mget<(Campaign | null)[]>(...ids.map(ITEM_KEY));
  const out: Campaign[] = [];
  items.forEach((it) => it && typeof it === "object" && out.push(it as Campaign));
  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return NextResponse.json(out);
}

// ---------- POST ----------
export async function POST(req: NextRequest) {
  // 1) зчитуємо тіло як JSON або FormData
  const ct = req.headers.get("content-type") || "";
  let body: any = {};
  if (ct.includes("application/json")) {
    try {
      body = (await req.json()) ?? {};
    } catch {
      body = {};
    }
  } else {
    const fd = await req.formData().catch(() => null);
    if (fd) {
      fd.forEach((v, k) => {
        (body as any)[k] = typeof v === "string" ? v : String(v);
      });
    }
  }

  // 2) будуємо цільовий обʼєкт
  const now = Date.now();
  const id = String(now);

  const base = targetFromFlat(body, "base");
  const t1 = targetFromFlat(body, "t1");
  const t2 = targetFromFlat(body, "t2");
  const texp = targetFromFlat(body, "texp");

  const v1 = pickStr(body.v1);
  const v2 = pickStr(body.v2);
  const expDays =
    pickNum(body.expDays) ?? pickNum(body.expireDays) ?? pickNum(body.expire) ?? pickNum(body.vexp);

  // 3) дозаповнюємо назви (не обовʼязково — але красиво)
  const [eBase, e1, e2, eExp] = await Promise.all([
    enrichNames(base),
    enrichNames(t1),
    enrichNames(t2),
    enrichNames(texp),
  ]);

  const campaign: Campaign = {
    id,
    name: pickStr(body.name) ?? "Без назви",
    base: eBase,
    t1: e1,
    t2: e2,
    texp: eExp,
    v1,
    v2,
    ...(expDays != null ? { expDays } : {}),
    counters: { v1: 0, v2: 0, exp: 0 },
    createdAt: now,
  };

  // 4) зберігаємо
  await storeCampaign(campaign);

  // 5) відповідаємо 201
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
