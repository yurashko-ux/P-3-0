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

// ---- IDS helpers: підтримка обох форматів (масив JSON — канонічний; list — тимчасовий) ----
type IdsMode = "array" | "list" | "missing";

async function getIds(): Promise<{ ids: string[]; mode: IdsMode }> {
  // 1) Канонічний формат — масив JSON
  const arr = await kv.get<string[] | null>(IDS_KEY);
  if (Array.isArray(arr)) {
    return { ids: arr.filter(Boolean), mode: "array" };
  }
  // 2) Спроба прочитати як Redis list (якщо випадково створений)
  try {
    const list = await kv.lrange<string>(IDS_KEY, 0, -1);
    if (Array.isArray(list) && list.length > 0) {
      return { ids: list.filter(Boolean), mode: "list" };
    }
  } catch {
    // ignore WRONGTYPE etc
  }
  return { ids: [], mode: "missing" };
}

async function saveIdsAsArray(ids: string[]) {
  await kv.set(IDS_KEY, ids);
}

async function saveIds(ids: string[], mode: IdsMode) {
  // Завжди мігруємо у канонічний формат: JSON-масив.
  // Це безпечніше для Next/Vercel (просте kv.get/kv.set).
  await saveIdsAsArray(ids);
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
  const { ids } = await getIds();
  if (!ids.length) return NextResponse.json<Campaign[]>([]);
  const keys = ids.map(ITEM_KEY);
  const items = await kv.mget<Campaign[]>(...keys);
  const list = (items ?? []).filter(Boolean) as Campaign[];
  return NextResponse.json(list);
}

// -------- POST /api/campaigns --------
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<Campaign>;

  const name = body.name?.trim();
  if (!name) return badRequest("name is required");

  // Парність pipeline/status
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

  // Збагачення назв (бекенд — джерело істини)
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

  // 1) Записати сам елемент
  await kv.set(ITEM_KEY(item.id), item);

  // 2) Оновити індекс у канонічному форматі (масив JSON)
  const { ids } = await getIds(); // прочитаємо, що є (масив або list)
  const next = [item.id, ...ids];
  await saveIds(next, "array");

  return NextResponse.json(item, { status: 201 });
}
