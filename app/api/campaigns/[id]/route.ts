import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const BUCKET = "campaigns";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const raw = await kv.hget<string>(BUCKET, params.id);
  if (!raw) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, item: JSON.parse(raw) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  await kv.hdel(BUCKET, params.id);
  return NextResponse.json({ ok: true });
}
