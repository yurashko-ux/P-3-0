// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  pipelineNameById,
  statusNameById,
} from "@/lib/lookups";

export const runtime = "nodejs";

type Counters = { v1: number; v2: number; exp: number };
type Base = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
export type Campaign = {
  id: string;
  name: string;
  v1: string | number | "—";
  v2: string | number | "—";
  base: Base;
  counters: Counters;
  deleted: boolean;
  createdAt: number;
};

const LIST_RO = "cmp:list:ids:RO";
const LIST_WR = "cmp:list:ids:WR";

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

async function getIds(): Promise<string[]> {
  // читаємо обидва списки й об’єднуємо
  const ro = (await kv.lrange<string>(LIST_RO, 0, -1)) || [];
  const wr = (await kv.lrange<string>(LIST_WR, 0, -1)) || [];
  return uniq([...ro, ...wr]);
}

async function getMany(ids: string[]): Promise<Campaign[]> {
  if (!ids.length) return [];
  const keys = ids.map(id => `cmp:${id}`);
  const values = await kv.mget<Campaign[]>(...keys);
  const out: Campaign[] = [];
  values.forEach((v: any) => {
    if (v && typeof v === "object") out.push(v as Campaign);
  });
  // свіжі зверху
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** GET /api/campaigns – список */
export async function GET() {
  const ids = await getIds();
  const items = await getMany(ids);
  return NextResponse.json({ ok: true, items });
}

/** POST /api/campaigns – створити */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (body?.name || "").toString().trim();
    const pipeline: string | undefined = body?.base?.pipeline || body?.pipeline;
    const status: string | undefined = body?.base?.status || body?.status;

    if (!name) {
      return NextResponse.json({ ok: false, error: "EMPTY_NAME" }, { status: 400 });
    }

    const id = Date.now().toString();

    const campaign: Campaign = {
      id,
      name,
      v1: "—",
      v2: "—",
      base: {
        pipeline,
        status,
        pipelineName: pipelineNameById(pipeline),
        statusName: statusNameById(status),
      },
      counters: { v1: 0, v2: 0, exp: 0 },
      deleted: false,
      createdAt: Number(id),
    };

    // пишемо сам об’єкт + додаємо в обидва списки ID
    await Promise.all([
      kv.set(`cmp:${id}`, campaign),
      kv.lpush(LIST_WR, id),
      kv.lpush(LIST_RO, id),
    ]);

    return NextResponse.json({ ok: true, id, item: campaign });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "CREATE_FAILED" }, { status: 500 });
  }
}
