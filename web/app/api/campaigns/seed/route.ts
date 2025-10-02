// web/app/api/campaigns/seed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

type Target = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
type Campaign = {
  id: string;
  name: string;
  base?: Target;
  t1?: Target;
  t2?: Target;
  texp?: Target;
  counters: { v1: number; v2: number; exp: number };
  createdAt: number;
  expDays?: number; // для відображення днів
};

async function seedOnce() {
  const id = String(Date.now());
  const demo: Campaign = {
    id,
    name: "Demo",
    base: { pipelineName: "Ігнор", statusName: "Успішний" },
    t1: { pipelineName: "Запит ціни", statusName: "Нема в наявності" },
    t2: { pipelineName: "Консультації", statusName: "Дотискання" },
    texp: { pipelineName: "Повторний", statusName: "Перший контакт" },
    counters: { v1: 0, v2: 0, exp: 0 },
    createdAt: Date.now(),
    expDays: 7,
  };

  await kv.set(ITEM_KEY(id), demo);

  const ids = (await kv.get<string[] | null>(IDS_KEY)) ?? [];
  const next = Array.isArray(ids) ? [id, ...ids.filter(Boolean)] : [id];
  await kv.set(IDS_KEY, next);

  return id;
}

// підтримуємо і GET, і POST
export async function GET(_req: NextRequest) {
  const id = await seedOnce();
  return NextResponse.json({ ok: true, id });
}

export async function POST(_req: NextRequest) {
  const id = await seedOnce();
  return NextResponse.json({ ok: true, id });
}
