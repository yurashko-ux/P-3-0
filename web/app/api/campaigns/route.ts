// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { Campaign, Target } from "@/lib/types";
import { getPipelineNameCached, getStatusNameCached } from "@/lib/keycrm-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

const json = (data: any, status = 200) =>
  new NextResponse(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function badRequest(message: string, extra?: any) {
  return json({ error: message, ...extra }, 400);
}
function unsupported(message: string) {
  return json({ error: message }, 415);
}
function serverError(message: string, extra?: any) {
  return json({ error: message, ...extra }, 500);
}

// ---- helpers: індекс ТІЛЬКИ JSON-масив ----
async function getIdsArray(): Promise<string[]> {
  const arr = await kv.get<string[] | null>(IDS_KEY);
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}
async function setIdsArray(ids: string[]) {
  await kv.set(IDS_KEY, ids);
}

async function safeEnrich(b?: Target): Promise<Target | undefined> {
  if (!b || !b.pipeline || !b.status) return b;

  let pipelineName = b.pipelineName;
  let statusName = b.statusName;

  try {
    if (!pipelineName) pipelineName = await getPipelineNameCached(b.pipeline);
    if (!statusName) statusName = await getStatusNameCached(b.pipeline, b.status);
  } catch {
    // імена добʼємо пізніше repair/sync
  }

  return { ...b, pipelineName: pipelineName ?? b.pipeline, statusName: statusName ?? b.status };
}

const newId = () => `${Date.now()}`;

// -------- GET /api/campaigns --------
export async function GET() {
  try {
    const ids = await getIdsArray();
    if (!ids.length) return json([]);
    const keys = ids.map(ITEM_KEY);
    const items = await kv.mget<(Campaign | null)[]>(...keys);
    const list = (items ?? []).filter(Boolean) as Campaign[];
    return json(list);
  } catch (e: any) {
    console.error("GET /api/campaigns failed:", e);
    return serverError("internal error");
  }
}

// -------- POST /api/campaigns (ТІЛЬКИ JSON) --------
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return unsupported("Content-Type must be application/json");
    }

    const body = (await req.json()) as Partial<Campaign> | undefined;
    if (!body) return badRequest("empty body");

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest("name is required");

    // валідація парності
    for (const [label, block] of [
      ["base", body.base],
      ["t1", body.t1],
      ["t2", body.t2],
      ["texp", body.texp],
    ] as const) {
      if (block?.pipeline && !block?.status) {
        return badRequest(`'${label}.status' is required when '${label}.pipeline' is set`);
      }
      if (block?.status && !block?.pipeline) {
        return badRequest(`'${label}.pipeline' is required when '${label}.status' is set`);
      }
    }

    // SAFE-enrich (через KV-кеш)
    const [base, t1, t2, texp] = await Promise.all([
      safeEnrich(body.base),
      safeEnrich(body.t1),
      safeEnrich(body.t2),
      safeEnrich(body.texp),
    ]);

    const item: Campaign = {
      id: newId(),
      name,
      v1: body.v1,
      v2: body.v2,
      base,
      t1,
      t2,
      texp,
      counters: body.counters ?? { v1: 0, v2: 0, exp: 0 },
      deleted: false,
      createdAt: Date.now(),
    };

    await kv.set(ITEM_KEY(item.id), item);
    const ids = await getIdsArray();
    ids.unshift(item.id);
    await setIdsArray(ids);

    return json(item, 201);
  } catch (err: any) {
    console.error("POST /api/campaigns failed:", err);
    return serverError(err?.message || "internal error");
  }
}
