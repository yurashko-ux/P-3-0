// web/app/api/campaigns/cleanup/route.ts
// POST /api/campaigns/cleanup?id={optionalId}&hard=1
// - з id: жорстко видаляє campaigns:{id} та ZREM з campaigns:index
// - без id: чистить «биті» елементи індексу (коли JSON відсутній або явний сміттєвий запис)

import { NextResponse } from "next/server";
import { assertAdmin } from "../../../../lib/auth";
import { kvGet, kvDel, kvZRem, kvZRange } from "../../../../lib/kv";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await assertAdmin(req);

  const u = new URL(req.url);
  const id = u.searchParams.get("id")?.trim();
  const hard = u.searchParams.get("hard") === "1";

  // Жорстке видалення конкретного id
  if (id) {
    const key = `campaigns:${id}`;
    const existed = Boolean(await kvGet(key));
    if (hard) {
      await kvDel(key).catch(() => {});
      await kvZRem("campaigns:index", id).catch(() => {});
    }
    return NextResponse.json({ ok: true, mode: "hard-delete", id, existed });
  }

  // Авточистка «битих» записів індексу
  const ids: string[] = (await kvZRange("campaigns:index", 0, -1)) ?? [];
  const removed: string[] = [];
  const kept: string[] = [];

  for (const cid of ids) {
    const raw = await kvGet(`campaigns:${cid}`);
    // якщо JSON відсутній — видаляємо з індексу
    if (!raw) {
      await kvZRem("campaigns:index", cid).catch(() => {});
      removed.push(cid);
      continue;
    }
    // мінімальна перевірка валідності
    const c = typeof raw === "string" ? safeParse(raw) : raw;
    const looksBroken =
      !c ||
      typeof c !== "object" ||
      (c.name === undefined && c.title === undefined && c.v1 === undefined);

    if (looksBroken) {
      await kvDel(`campaigns:${cid}`).catch(() => {});
      await kvZRem("campaigns:index", cid).catch(() => {});
      removed.push(cid);
    } else {
      kept.push(cid);
    }
  }

  return NextResponse.json({ ok: true, removed, kept, total: { index: ids.length, removed: removed.length } });
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}
