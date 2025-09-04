import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

type Rule = {
  value?: string;
  to_pipeline_id: number;
  to_status_id: number;
  to_pipeline_label?: string;
  to_status_label?: string;
};

export type Campaign = {
  id: string;
  createdAt: string; // ISO
  rule1?: Rule;
  rule2?: Rule;
  expire_days?: number;
  expire_to?: Omit<Rule, "value">;

  // Сумісність зі старим форматом
  fromPipelineId?: number | string;
  fromStatusId?: number | string;
  toPipelineId?: number | string;
  toStatusId?: number | string;
  expiresDays?: number | null;
  fromPipelineLabel?: string;
  fromStatusLabel?: string;
  toPipelineLabel?: string;
  toStatusLabel?: string;
};

const BUCKET = "campaigns";

function normalize(body: any): Campaign {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...body,
  };
}

export async function GET() {
  const map = await kv.hgetall<Campaign>(BUCKET);
  const items = map ? Object.values(map) : [];
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const item = normalize(body);
  await kv.hset(BUCKET, { [item.id]: item });
  return NextResponse.json({ ok: true, item });
}
