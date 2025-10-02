// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { Campaign, Target } from "@/lib/types";
import { getPipelineName, getStatusName } from "@/lib/keycrm";

export const runtime = "nodejs"; // стабільний fetch/KV + in-memory кеш під час запиту
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
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
  return `${Date.now()}`; // можна замінити на nanoid()
}

// -------- GET /api/campaigns --------
export async function GET() {
  const ids = ((await kv.get<string[]>(IDS_KEY)) ?? []).filter(Boolean);
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

  // Правило парності: якщо задано pipeline, обов'язково потрібен status, і навпаки
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

  // Збагачуємо назвами на бекенді (джерело істини)
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

  // Зберігаємо (prepend id у cmp:ids для сортування за новизною)
  const tx = kv.multi();
  tx.lpush(IDS_KEY, item.id);
  tx.set(ITEM_KEY(item.id), item);
  await tx.exec();

  return NextResponse.json(item, { status: 201 });
}
