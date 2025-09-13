// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

/* Типи – мінімальні, щоб TS не лаявся */
type VariantRule = {
  enabled?: boolean;
  field?: "text";
  op?: "contains" | "equals";
  value?: string;
};
type Campaign = {
  id: number;
  name: string;
  active: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  rules: { v1: VariantRule; v2?: VariantRule };
  v1_pipeline_id?: number | null;
  v1_status_id?: number | null;
  v2_pipeline_id?: number | null;
  v2_status_id?: number | null;
  exp_days?: number | null;
  exp_to_pipeline_id?: number | null;
  exp_to_status_id?: number | null;
  counters: { v1: number; v2: number; exp: number };
  created_at: string;
  updated_at: string;
  deleted?: boolean;
};

/* ----------------------------- GET: список ----------------------------- */
export async function GET(req: Request) {
  await assertAdmin(req);

  // беремо всі id зі zset
  const ids = (await kvZRange("campaigns:index", 0, -1)) as string[] | null;
  const out: Campaign[] = [];

  for (const id of ids || []) {
    const row = await kvGet(`campaigns:${id}`);
    if (!row) continue;
    const obj: Campaign =
      typeof row === "string" ? (JSON.parse(row) as Campaign) : (row as Campaign);
    if (obj?.deleted) continue;
    out.push(obj);
  }

  // новіші — вище (zset і так за score, але дублюємо на всяк)
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return NextResponse.json({ ok: true, data: out });
}

/* ----------------------------- POST: створити ----------------------------- */
export async function POST(req: Request) {
  await assertAdmin(req);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // обов'язкові поля
  const name = String(body?.name ?? "").trim();
  const base_pipeline_id = Number(body?.base_pipeline_id);
  const base_status_id = Number(body?.base_status_id);

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "name is required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(base_pipeline_id) || !Number.isFinite(base_status_id)) {
    return NextResponse.json(
      { ok: false, error: "base_pipeline_id & base_status_id are required" },
      { status: 400 }
    );
  }

  // валідація правил: v1.value — обов’язково непорожнє
  const v1: VariantRule = body?.rules?.v1 ?? {};
  if (!v1?.value || String(v1.value).trim() === "") {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }
  // нормалізація правил
  const rules: { v1: VariantRule; v2?: VariantRule } = {
    v1: {
      enabled: v1.enabled !== false,
      field: "text",
      op: (v1.op as any) === "equals" ? "equals" : "contains",
      value: String(v1.value).trim(),
    },
  };
  const v2: VariantRule | undefined = body?.rules?.v2;
  if (v2 && typeof v2.value === "string" && v2.value.trim() !== "") {
    rules.v2 = {
      enabled: v2.enabled !== false,
      field: "text",
      op: (v2.op as any) === "equals" ? "equals" : "contains",
      value: String(v2.value).trim(),
    };
  }

  // гарантія унікальності варіантів по всіх НЕ видалених кампаніях
  await assertVariantsUniqueOrThrow({
    v1: rules.v1,
    v2: rules.v2,
  });

  // формуємо об’єкт кампанії
  const nowIso = new Date().toISOString();
  const id = Date.now(); // простий монотонний id

  const created: Campaign = {
    id,
    name,
    active: body?.active !== false, // за замовчуванням вкл.
    base_pipeline_id,
    base_status_id,
    v1_pipeline_id: Number.isFinite(Number(body?.v1_pipeline_id))
      ? Number(body?.v1_pipeline_id)
      : null,
    v1_status_id: Number.isFinite(Number(body?.v1_status_id))
      ? Number(body?.v1_status_id)
      : null,
    v2_pipeline_id: Number.isFinite(Number(body?.v2_pipeline_id))
      ? Number(body?.v2_pipeline_id)
      : null,
    v2_status_id: Number.isFinite(Number(body?.v2_status_id))
      ? Number(body?.v2_status_id)
      : null,
    exp_days: Number.isFinite(Number(body?.exp_days))
      ? Number(body?.exp_days)
      : null,
    exp_to_pipeline_id: Number.isFinite(Number(body?.exp_to_pipeline_id))
      ? Number(body?.exp_to_pipeline_id)
      : null,
    exp_to_status_id: Number.isFinite(Number(body?.exp_to_status_id))
      ? Number(body?.exp_to_status_id)
      : null,
    rules,
    counters: { v1: 0, v2: 0, exp: 0 },
    created_at: nowIso,
    updated_at: nowIso,
    deleted: false,
  };

  // зберігаємо
  await kvSet(`campaigns:${id}`, created);
  await kvZAdd("campaigns:index", Date.now(), String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
