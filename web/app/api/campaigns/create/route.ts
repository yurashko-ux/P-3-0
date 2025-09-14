// web/app/api/campaigns/create/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvSet, kvZAdd } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

type Op = "contains" | "equals";

function toStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}
function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}
function ok(data: unknown, status = 201) {
  return NextResponse.json({ ok: true, data }, { status });
}

export async function POST(req: Request) {
  await assertAdmin(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON body");
  }

  // ---- basic fields
  const name = toStr(body?.name);
  if (!name) return bad(400, "name is required");

  const base_pipeline_id = toInt(body?.base_pipeline_id);
  if (!isPositiveInt(base_pipeline_id))
    return bad(400, "base_pipeline_id must be a positive integer");

  const base_status_id = toInt(body?.base_status_id);
  if (!isPositiveInt(base_status_id))
    return bad(400, "base_status_id must be a positive integer");

  // ---- rules.v1 (required)
  const v1op = toStr(body?.rules?.v1?.op) as Op;
  const v1value = toStr(body?.rules?.v1?.value);
  if (!v1value) {
    // зберігаємо точний текст, який очікує фронт
    return bad(400, "rules.v1.value is required (non-empty)");
  }
  if (v1op !== "contains" && v1op !== "equals") {
    return bad(400, "rules.v1.op must be 'contains' or 'equals'");
  }

  // ---- rules.v2 (optional)
  let v2:
    | {
        field: "text";
        op: Op;
        value: string;
      }
    | undefined = undefined;

  const maybeV2 = body?.rules?.v2 ?? undefined;
  const v2op = toStr(maybeV2?.op) as Op;
  const v2value = toStr(maybeV2?.value);
  if (v2value) {
    if (v2op !== "contains" && v2op !== "equals") {
      return bad(400, "rules.v2.op must be 'contains' or 'equals'");
    }
    v2 = { field: "text", op: v2op, value: v2value };
  }

  // ---- expire (optional)
  let expire:
    | {
        days: number;
        to_pipeline_id: number;
        to_status_id: number;
      }
    | undefined = undefined;

  if (body?.expire) {
    const days = toInt(body.expire.days);
    const to_pipeline_id = toInt(body.expire.to_pipeline_id);
    const to_status_id = toInt(body.expire.to_status_id);
    if (!isPositiveInt(days)) return bad(400, "expire.days must be a positive integer");
    if (!isPositiveInt(to_pipeline_id)) return bad(400, "expire.to_pipeline_id must be a positive integer");
    if (!isPositiveInt(to_status_id)) return bad(400, "expire.to_status_id must be a positive integer");
    expire = { days, to_pipeline_id, to_status_id };
  }

  // ---- унікальність варіантів серед НЕ видалених кампаній
  await assertVariantsUniqueOrThrow({
    v1: { field: "text", op: v1op, value: v1value },
    v2,
  });

  const now = Date.now();
  const id = now; // простий id на основі часу

  const created = {
    id,
    name,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    active: true as const,

    base_pipeline_id,
    base_status_id,

    rules: {
      v1: { field: "text" as const, op: v1op, value: v1value },
      ...(v2 ? { v2 } : {}),
    },

    expire,

    // стартові лічильники
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  // зберігаємо в KV
  await kvSet(`campaigns:${id}`, JSON.stringify(created));
  await kvZAdd("campaigns:index", now, String(id));

  return ok(created, 201);
}
