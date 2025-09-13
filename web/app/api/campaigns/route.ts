// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";
import {
  assertVariantsUniqueOrThrow,
  toStringOrUndefined,
} from "@/lib/campaigns-unique";

/** Типи лише для підказок — можна не змінювати інші файли */
type Rule = {
  enabled?: boolean;
  field?: "text";
  op?: "contains" | "equals";
  value?: string;
};
type Campaign = {
  id: number;
  name: string;

  // базова пара для синхронізації/пошуку
  base_pipeline_id: number;
  base_status_id: number;

  // варіант 1 (обов’язковий)
  v1_pipeline_id: number | null;
  v1_status_id: number | null;

  // варіант 2 (опційний)
  v2_pipeline_id: number | null;
  v2_status_id: number | null;

  // expire
  exp_days?: number | null;
  exp_to_pipeline_id?: number | null;
  exp_to_status_id?: number | null;

  // правила
  rules: {
    v1: Rule;
    v2?: Rule;
  };

  // службові
  active?: boolean;
  created_at?: string;
  updated_at?: string;

  // лічильники
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

/** Допоміжне: безпечно взяти число або null */
function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ТОЛЕРАНТНА нормалізація тіла запиту з форми */
function normalizeIncoming(body: any) {
  // значення варіантів може приходити у різних полях
  const v1Value =
    toStringOrUndefined(
      body?.rules?.v1?.value ??
        body?.v1_value ??
        body?.v1 ??
        body?.variant1 ??
        body?.variant_1 ??
        body?.value_v1
    ) || "";

  const v2Value =
    toStringOrUndefined(
      body?.rules?.v2?.value ??
        body?.v2_value ??
        body?.v2 ??
        body?.variant2 ??
        body?.variant_2 ??
        body?.value_v2
    ) || "";

  const v1Rule: Rule = {
    enabled: body?.rules?.v1?.enabled ?? true,
    field: "text",
    op: (body?.rules?.v1?.op as Rule["op"]) ?? "equals",
    value: v1Value,
  };

  const v2Rule: Rule | undefined =
    v2Value
      ? {
          enabled: body?.rules?.v2?.enabled ?? true,
          field: "text",
          op: (body?.rules?.v2?.op as Rule["op"]) ?? "equals",
          value: v2Value,
        }
      : undefined;

  // формуємо об’єкт кампанії у спільній схемі
  const candidate: Omit<Campaign, "id"> = {
    name: toStringOrUndefined(body?.name) || "Campaign",
    base_pipeline_id: Number(body?.base_pipeline_id),
    base_status_id: Number(body?.base_status_id),

    v1_pipeline_id: num(body?.v1_pipeline_id),
    v1_status_id: num(body?.v1_status_id),

    v2_pipeline_id: num(body?.v2_pipeline_id),
    v2_status_id: num(body?.v2_status_id),

    exp_days: num(body?.exp_days),
    exp_to_pipeline_id: num(body?.exp_to_pipeline_id),
    exp_to_status_id: num(body?.exp_to_status_id),

    rules: { v1: v1Rule, ...(v2Rule ? { v2: v2Rule } : {}) },

    active: body?.active ?? true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),

    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  return candidate;
}

/** GET: список кампаній */
export async function GET() {
  // беремо всі id зі ZSET індексу
  const ids = (await kvZRange("campaigns:index", 0, -1, true)) as string[]; // true → у зворотному порядку (як реалізовано у вашому kv.ts)
  const out: Campaign[] = [];
  for (const id of ids || []) {
    const row = await kvGet(`campaigns:${id}`);
    if (row) out.push(row as Campaign);
  }
  return NextResponse.json({ ok: true, data: out });
}

/** POST: створення кампанії (з толерантною нормалізацією rules.v1/value) */
export async function POST(req: Request) {
  try {
    await assertAdmin(req);

    const body = await req.json().catch(() => ({}));
    const candidate = normalizeIncoming(body);

    // обов’язкові поля:
    if (!candidate.base_pipeline_id || !candidate.base_status_id) {
      return NextResponse.json(
        { ok: false, error: "base_pipeline_id & base_status_id are required" },
        { status: 400 }
      );
    }
    if (!candidate.rules?.v1?.value || candidate.rules.v1.value.trim() === "") {
      // <- те саме повідомлення, але тепер ми майже завжди підставляємо з v1/variant1
      return NextResponse.json(
        { ok: false, error: "rules.v1.value is required (non-empty)" },
        { status: 400 }
      );
    }

    // перевірка унікальності значень варіантів серед УСІХ не видалених кампаній
    await assertVariantsUniqueOrThrow({
      // id відсутній (створення) — передамо undefined
      id: undefined,
      v1: candidate.rules.v1.value!,
      v2: candidate.rules?.v2?.value || undefined,
    });

    // створюємо id без kvIncr, щоб не залежати від нього
    const id = Date.now();

    const created: Campaign = {
      id,
      ...candidate,
    };

    // зберігаємо
    await kvSet(`campaigns:${id}`, created);
    await kvZAdd("campaigns:index", Date.now(), String(id));

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (e: any) {
    const msg =
      e?.message ||
      e?.toString?.() ||
      "failed to create campaign (unexpected error)";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
