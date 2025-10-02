// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { Campaign, Target } from "@/lib/types";
import { getPipelineName, getStatusName } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

// ---- helpers: ПРАЦЮЄМО ЛИШЕ З JSON-МАСИВОМ ----
async function getIdsArray(): Promise<string[]> {
  const arr = await kv.get<string[] | null>(IDS_KEY);
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}
async function setIdsArray(ids: string[]) {
  await kv.set(IDS_KEY, ids);
}

async function enrichNames(b?: Target): Promise<Target | undefined> {
  if (!b || !b.pipeline || !b.status) return b;
  const pipelineName =
    b.pipelineName ?? (await getPipelineName(b.pipeline)).toString();
  const statusName =
    b.statusName ?? (await getStatusName(b.pipeline, b.status)).toString();
  return { ...b, pipelineName, statusName };
}

function newId() {
  return `${Date.now()}`; // або nanoid()
}

// -------- GET /api/campaigns --------
export async function GET() {
  const ids = await getIdsArray();
  if (!ids.length) return NextResponse.json<Campaign[]>([]);
  const keys = ids.map(ITEM_KEY);
  const items = await kv.mget<(Campaign | null)[]>(...keys);
  const list = (items ?? []).filter(Boolean) as Campaign[];
  return NextResponse.json(list);
}

// -------- POST /api/campaigns --------
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<Campaign>;

  const name = body.name?.trim();
  if (!name) return badRequest("name is required");

  // Парність pipeline/status для кожного блоку
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

  // Збагачення назв на бекенді
  const [base, t1, t2, texp] = await Promise.all([
    enrichNames(body.base),
    enrichNames(body.t1),
    enrichNames(body.t2),
    enrichNames(body.texp),
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

  // 1) Запис елемента
  await kv.set(ITEM_KEY(item.id), item);

  // 2) Оновлення індексу (JSON-масив)
  const ids = await getIdsArray();
  ids.unshift(item.id);
  await setIdsArray(ids);

  return NextResponse.json(item, { status: 201 });
}
