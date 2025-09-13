// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

/** Допоміжні: перетворюємо будь-що у непорожній рядок або кидаємо помилку */
function toNonEmptyString(v: unknown, path: string): string {
  const s = (v ?? "").toString().trim();
  if (!s) throw new Error(`${path} is required (non-empty)`);
  return s;
}
function toOptionalString(v: unknown): string | undefined {
  const s = (v ?? "").toString().trim();
  return s ? s : undefined;
}

/** GET: список кампаній */
export async function GET(req: Request) {
  await assertAdmin(req);
  const ids: string[] = (await kvZRange("campaigns:index", 0, -1)) || [];
  const out: any[] = [];
  for (const id of ids) {
    const row = await kvGet(`campaigns:${id}`);
    if (row) out.push(row);
  }
  return NextResponse.json({ ok: true, data: out });
}

/** POST: створення кампанії */
export async function POST(req: Request) {
  await assertAdmin(req);
  const body = await req.json();

  // ---- Н О Р М А Л І З А Ц І Я  &  В А Л І Д А Ц І Я ----
  // Примусово робимо value рядками (це і є виправлення помилки)
  const v1Value = toNonEmptyString(body?.rules?.v1?.value, "rules.v1.value");
  const v1Field = body?.rules?.v1?.field ?? "text";
  const v1Op = body?.rules?.v1?.op ?? "contains";

  const v2ValueOpt = toOptionalString(body?.rules?.v2?.value);
  const v2Field = body?.rules?.v2?.field ?? "text";
  const v2Op = body?.rules?.v2?.op ?? "contains";

  const candidate = {
    id: Date.now(), // якщо у тебе є kvIncr — можеш замінити тут на інкремент
    name: toNonEmptyString(body?.name, "name"),
    base_pipeline_id: Number(body?.base_pipeline_id),
    base_status_id: Number(body?.base_status_id),
    rules: {
      v1: { field: v1Field, op: v1Op, value: v1Value },
      // v2 зберігаємо лише якщо value непорожній після тріммінгу
      ...(v2ValueOpt ? { v2: { field: v2Field, op: v2Op, value: v2ValueOpt } } : {}),
    },
    exp: body?.exp
      ? {
          days: Number(body.exp?.days ?? 0),
          to_pipeline_id: Number(body.exp?.to_pipeline_id),
          to_status_id: Number(body.exp?.to_status_id),
        }
      : undefined,
    counters: { v1: 0, v2: 0, exp: 0 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Перевірка унікальності значень варіантів серед усіх НЕ видалених кампаній
  await assertVariantsUniqueOrThrow({
    v1: candidate.rules.v1,
    v2: candidate.rules?.v2,
  });

  // ---- З Б Е Р Е Ж Е Н Н Я ----
  const id = candidate.id;
  await kvSet(`campaigns:${id}`, candidate);
  await kvZAdd("campaigns:index", Date.now(), String(id));

  return NextResponse.json({ ok: true, data: candidate }, { status: 201 });
}
