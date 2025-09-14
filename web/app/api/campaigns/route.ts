// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRevRange } from "@/lib/kv";
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
function ok(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

/** Дістаємо value для v1/v2 з будь-яких можливих назв полів */
function pickRuleValue(body: any, which: "v1" | "v2"): string {
  const b = body ?? {};
  const r = b.rules ?? {};
  const candidates: unknown[] = [
    r?.[which]?.value,
    r?.[which]?.text,
    r?.[which]?.pattern,
    r?.[`${which}_value`],
    r?.[`${which}Value`],
    b?.[which]?.value,
    b?.[which],
    b?.[`${which}_value`],
    b?.[`${which}Value`],
    b?.[`value${which === "v1" ? "1" : "2"}`],
    b?.[`variant${which === "v1" ? "1" : "2"}`]?.value,
  ];
  for (const c of candidates) {
    const s = toStr(c);
    if (s) return s;
  }
  return "";
}

/** Дістаємо op для v1/v2 (за замовчуванням 'contains') */
function pickRuleOp(body: any, which: "v1" | "v2"): Op {
  const raw =
    toStr(body?.rules?.[which]?.op) ||
    toStr(body?.[which]?.op) ||
    toStr(body?.[`${which}_op`]) ||
    toStr(body?.[`${which}Op`]) ||
    "contains";
  return raw === "equals" ? "equals" : "contains";
}

export async function GET(req: Request) {
  await assertAdmin(req);

  // нові зверху
  const ids = await kvZRevRange("campaigns:index", 0, -1);
  const out: any[] = [];
  for (const id of ids ?? []) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    try {
      out.push(typeof raw === "string" ? JSON.parse(raw) : raw);
    } catch {
      // пропускаємо поламані записи
    }
  }
  return ok({ items: out });
}

export async function POST(req: Request) {
  await assertAdmin(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON body");
  }

  // базові поля
  const name = toStr(body?.name);
  if (!name) return bad(400, "name is required");

  const base_pipeline_id = toInt(body?.base_pipeline_id);
  if (!isPositiveInt(base_pipeline_id))
    return bad(400, "base_pipeline_id must be a positive integer");

  const base_status_id = toInt(body?.base_status_id);
  if (!isPositiveInt(base_status_id))
    return bad(400, "base_status_id must be a positive integer");

  // правила
  const v1value = pickRuleValue(body, "v1");
  if (!v1value) {
    // лишаємо точний текст, на який орієнтується фронт
    return bad(400, "rules.v1.value is required (non-empty)");
  }
  const v1op: Op = pickRuleOp(body, "v1");

  const v2value = pickRuleValue(body, "v2");
  const v2op: Op = pickRuleOp(body, "v2");

  // expire (опційно)
  let expire:
    | { days: number; to_pipeline_id: number; to_status_id: number }
    | undefined;
  if (body?.expire) {
    const days = toInt(body.expire.days);
    const to_pipeline_id = toInt(body.expire.to_pipeline_id);
    const to_status_id = toInt(body.expire.to_status_id);
    if (!isPositiveInt(days)) return bad(400, "expire.days must be a positive integer");
    if (!isPositiveInt(to_pipeline_id)) return bad(400, "expire.to_pipeline_id must be a positive integer");
    if (!isPositiveInt(to_status_id)) return bad(400, "expire.to_status_id must be a positive integer");
    expire = { days, to_pipeline_id, to_status_id };
  }

  // унікальність по НЕ видалених кампаніях
  await assertVariantsUniqueOrThrow({
    v1: { field: "text", op: v1op, value: v1value },
    v2: v2value
      ? { field: "text", op: v2op, value: v2value }
      : undefined,
  });

  const now = Date.now();
  const id = now;

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
      ...(v2value ? { v2: { field: "text" as const, op: v2op, value: v2value } } : {}),
    },

    expire,

    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  await kvSet(`campaigns:${id}`, JSON.stringify(created));
  await kvZAdd("campaigns:index", now, String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
