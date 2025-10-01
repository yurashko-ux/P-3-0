// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  pipelineNameById,
  statusNameById,
} from "@/lib/lookups";

export const runtime = "nodejs";

type Counters = { v1: number; v2: number; exp: number };

type Stage = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

export type Campaign = {
  id: string;
  name: string;
  // Варіанти відображення в таблиці
  v1: string | number | "—";
  v2: string | number | "—";
  // Блоки
  base: Stage;    // Базова воронка/статус
  alt1: Stage & { value?: number | string }; // Варіант 1
  alt2: Stage & { value?: number | string }; // Варіант 2
  expire: Stage & { days?: number };         // Expire
  counters: Counters;
  deleted: boolean;
  createdAt: number;
};

const LIST_RO = "cmp:list:ids:RO";
const LIST_WR = "cmp:list:ids:WR";

function uniq(arr: string[]) { return Array.from(new Set(arr.filter(Boolean))); }

async function getIds(): Promise<string[]> {
  const [ro, wr] = await Promise.all([
    kv.lrange<string>(LIST_RO, 0, -1),
    kv.lrange<string>(LIST_WR, 0, -1),
  ]);
  return uniq([...(ro || []), ...(wr || [])]);
}
async function getMany(ids: string[]): Promise<Campaign[]> {
  if (!ids.length) return [];
  const keys = ids.map(id => `cmp:${id}`);
  const values = await kv.mget<Campaign[]>(...keys);
  const out: Campaign[] = [];
  values.forEach((v: any) => { if (v && typeof v === "object") out.push(v as Campaign); });
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function GET() {
  const ids = await getIds();
  const items = await getMany(ids);
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const name = (body?.name ?? "").toString().trim();
    if (!name) return NextResponse.json({ ok: false, error: "EMPTY_NAME" }, { status: 400 });

    // базовий блок
    const basePipeline: string | undefined = body?.base?.pipeline;
    const baseStatus: string | undefined = body?.base?.status;

    // варіанти
    const alt1Value = body?.alt1?.value ?? body?.v1 ?? "";
    const alt1Pipeline: string | undefined = body?.alt1?.pipeline;
    const alt1Status: string | undefined = body?.alt1?.status;

    const alt2Value = body?.alt2?.value ?? body?.v2 ?? "";
    const alt2Pipeline: string | undefined = body?.alt2?.pipeline;
    const alt2Status: string | undefined = body?.alt2?.status;

    // expire
    const expDays = Number(body?.expire?.days ?? body?.exp ?? 0) || 0;
    const expPipeline: string | undefined = body?.expire?.pipeline;
    const expStatus: string | undefined = body?.expire?.status;

    const id = Date.now().toString();

    const item: Campaign = {
      id,
      name,
      v1: String(alt1Value || "—"),
      v2: String(alt2Value || "—"),
      base: {
        pipeline: basePipeline,
        status: baseStatus,
        pipelineName: pipelineNameById(basePipeline),
        statusName: statusNameById(baseStatus),
      },
      alt1: {
        value: alt1Value,
        pipeline: alt1Pipeline,
        status: alt1Status,
        pipelineName: pipelineNameById(alt1Pipeline),
        statusName: statusNameById(alt1Status),
      },
      alt2: {
        value: alt2Value,
        pipeline: alt2Pipeline,
        status: alt2Status,
        pipelineName: pipelineNameById(alt2Pipeline),
        statusName: statusNameById(alt2Status),
      },
      expire: {
        days: expDays,
        pipeline: expPipeline,
        status: expStatus,
        pipelineName: pipelineNameById(expPipeline),
        statusName: statusNameById(expStatus),
      },
      counters: { v1: 0, v2: 0, exp: expDays },
      deleted: false,
      createdAt: Number(id),
    };

    await Promise.all([
      kv.set(`cmp:${id}`, item),
      kv.lpush(LIST_WR, id),
      kv.lpush(LIST_RO, id),
    ]);

    return NextResponse.json({ ok: true, id, item });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "CREATE_FAILED" }, { status: 500 });
  }
}
