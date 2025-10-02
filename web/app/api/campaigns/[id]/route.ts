// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;
  const tx = kv.multi();
  tx.lrem(IDS_KEY, 0, id); // прибрати з індексу
  tx.del(ITEM_KEY(id));    // видалити елемент
  await tx.exec();
  return NextResponse.json({ ok: true, id });
}
