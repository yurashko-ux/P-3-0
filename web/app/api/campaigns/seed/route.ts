// web/app/api/campaigns/seed/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function id() { return String(Date.now()); }

export async function POST() {
  const a = {
    id: id(),
    name: "UI-created",
    base: { pipelineName: "—", statusName: "—" },
    counters: { v1: 0, v2: 0, exp: 0 },
  };
  const b = {
    id: id(),
    name: "Welcome Flow",
    base: { pipelineName: "Signup", statusName: "Active" },
    counters: { v1: 3, v2: 1, exp: 0 },
  };

  await kv.set(`cmp:item:${a.id}`, a);
  await kv.set(`cmp:item:${b.id}`, b);

  // тримаємо списки у двох “каналах” — RO/WR
  const ro = [`${a.id}`];
  const wr = [`${b.id}`];
  await kv.set("cmp:list:ids:RO", ro);
  await kv.set("cmp:list:ids:WR", wr);

  return NextResponse.json({ ok: true, created: [a.id, b.id] });
}
