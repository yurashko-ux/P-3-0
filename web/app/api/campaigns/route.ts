// web/app/api/campaigns/route.ts
/*  ──────────────────────────────────────────────────────────────────────────
    GET  /api/campaigns   → список кампаній (адмін)
    POST /api/campaigns   → створити кампанію (адмін) + перевірка унікальності
    ────────────────────────────────────────────────────────────────────────── */

import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRevRange } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/** Допоміжне: безпечно парсити (kv може повертати string або object) */
function safeParse<T = any>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as T;
  return null;
}

/** Допоміжне: нормалізувати rule з двох можливих форм:
 *  1) { field:'text', op:'contains'|'equals', value:string }
 *  2) "просто значення" (рядок/число) з UI — трактуємо як {field:'text',op:'contains'}
 */
type VariantRule = { field: "text"; op: "contains" | "equals"; value: string };
function normalizeRuleInput(x: any): VariantRule | undefined {
  if (x == null) return undefined;

  // коротка форма: "1", 1, "  hi  "
  if (typeof x === "string" || typeof x === "number") {
    const v = String(x).trim();
    if (!v) return undefined;
    return { field: "text", op: "contains", value: v };
  }

  // об’єктна форма
  if (typeof x === "object") {
    const value = String(x.value ?? "").trim();
    if (!value) return undefined;
    const op: "contains" | "equals" = x.op === "equals" ? "equals" : "contains";
    return { field: "text", op, value };
  }

  return undefined;
}

/** Схема кампанії для збереження */
type Campaign = {
  id: number | string;
  name: string;
  active: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  rules: {
    v1: VariantRule;          // обов’язково
    v2?: VariantRule | null;  // опційно
  };
  expire?: {
    days?: number;
    to_pipeline_id?: number | null;
    to_status_id?: number | null;
  };
  counters?: {
    v1_count?: number;
    v2_count?: number;
    exp_count?: number;
  };
  created_at: string;
  updated_at: string;
};

/* ───────────────────────────── GET (list) ──────────────────────────────── */
export async function GET(req: Request) {
  await assertAdmin(req);

  // найновіші спочатку
  const ids = (await kvZRevRange("campaigns:index", 0, -1)) || [];
  const out: Campaign[] = [];

  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    const c = safeParse<Campaign>(raw);
    if (c) out.push(c);
  }

  return NextResponse.json({ ok: true, data: out });
}

/* ───────────────────────────── POST (create) ───────────────────────────── */
export async function POST(req: Request) {
  await assertAdmin(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Базові поля
  const name = String(body?.name ?? "").trim();
  const base_pipeline_id = Number(body?.base_pipeline_id);
  const base_status_id = Number(body?.base_status_id);

  // Нормалізуємо правила з обох можливих форм UI
  const v1 = normalizeRuleInput(body?.rules?.v1);
  const v2 = normalizeRuleInput(body?.rules?.v2);

  // Перевірки
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "name is required (non-empty)" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(base_pipeline_id) || !Number.isFinite(base_status_id)) {
    return NextResponse.json(
      { ok: false, error: "base_pipeline_id and base_status_id are required (numbers)" },
      { status: 400 }
    );
  }
  if (!v1 || !v1.value?.trim()) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  // Перевірка унікальності варіантів по ВСІХ (крім видалених)
  await assertVariantsUniqueOrThrow({
    v1,
    v2, // може бути undefined — валідатор це врахує
  });

  // Формуємо об’єкт кампанії
  const nowIso = new Date().toISOString();
  const id = Date.now(); // простий монотонний ідентифікатор
  const created: Campaign = {
    id,
    name,
    active: true,
    base_pipeline_id,
    base_status_id,
    rules: { v1, ...(v2 ? { v2 } : {}) },
    expire: {
      days: Number.isFinite(Number(body?.expire?.days)) ? Number(body?.expire?.days) : undefined,
      to_pipeline_id: body?.expire?.to_pipeline_id != null ? Number(body?.expire?.to_pipeline_id) : undefined,
      to_status_id: body?.expire?.to_status_id != null ? Number(body?.expire?.to_status_id) : undefined,
    },
    counters: { v1_count: 0, v2_count: 0, exp_count: 0 },
    created_at: nowIso,
    updated_at: nowIso,
  };

  // Зберігаємо: саму кампанію та її id в індекс
  await kvSet(`campaigns:${id}`, created);
  await kvZAdd("campaigns:index", Date.now(), String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
