// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

type Params = { params: { id: string } };

async function safeLrem(key: string, id: string) {
  try {
    // @ts-ignore - метод є в @vercel/kv
    await kv.lrem(key, 0, id);
  } catch {
    // ігноруємо — ключ може бути відсутній або не списком
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const id = String(params?.id || "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    // основний ключ кампанії
    await kv.del(`campaign:${id}`);

    // приберемо id з відомих списків (обидва випадки)
    await safeLrem("cmp:list:ids:WR", id);
    await safeLrem("cmp:list:ids:RO", id);
    await safeLrem("campaigns:ids", id); // на випадок іншої назви

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "DELETE_FAILED" },
      { status: 500 }
    );
  }
}
