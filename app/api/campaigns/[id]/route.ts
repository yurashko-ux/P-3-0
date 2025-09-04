import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

type Campaign = any;
const BUCKET = "campaigns";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const item = await kv.hget<Campaign>(BUCKET, params.id);
  if (!item) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, item });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const existing = await kv.hget<Campaign>(BUCKET, params.id);
  if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const patch = await req.json().catch(() => ({}));
  const updated = { ...existing, ...patch };
  await kv.hset(BUCKET, { [params.id]: updated });
  return NextResponse.json({ ok: true, item: updated });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await kv.hdel(BUCKET, params.id);
  return NextResponse.json({ ok: true });
}
