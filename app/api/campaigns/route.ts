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
  // ВАЖЛИВО: hgetall<T> очікує T як Record<string, V>, інакше Object.values()
  // перетворить Campaign у union полів (string | number | Rule | ...).
  const map = await kv.hgetall<Record<string, Campaign>>(BUCKET);
  const items: Campaign[] = map ? Object.values(map) : [];
  items.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const item = normalize(body);
  await kv.hset(BUCKET, { [item.id]: item });
  return NextResponse.json({ ok: true, item });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { id, ...patch } = body || {};
  if (!id)
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400 }
    );

  const existing = await kv.hget<Campaign>(BUCKET, id);
  if (!existing)
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );

  const updated: Campaign = { ...existing, ...patch };
  await kv.hset(BUCKET, { [id]: updated });
  return NextResponse.json({ ok: true, item: updated });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = body?.id as string | undefined;
  if (!id)
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400 }
    );

  await kv.hdel(BUCKET, id);
  return NextResponse.json({ ok: true });
}
