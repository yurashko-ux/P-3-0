// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange, kvIncr } from "@/lib/kv";
import {
  assertVariantsUniqueOrThrow,
  type VariantRule,
  type Campaign as UniqueCampaign,
} from "@/lib/campaigns-unique";

export const dynamic = "force-dynamic";

// ==== Типи для цього роуту (сумісні з campaigns-unique) ====
type CampaignDTO = {
  name: string;
  active?: boolean;
  base_pipeline_id: number | string;
  base_status_id: number | string;

  // необов’язкові лічильники/налаштування
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  // expire-логіка (опційно)
  exp_days?: number;
  exp_to_pipeline_id?: number | string;
  exp_to_status_id?: number | string;

  rules?: {
    v1?: VariantRule;
    v2?: VariantRule;
  };
};

type StoredCampaign = CampaignDTO & {
  id: number | string;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
  deleted_at?: string | null;
  status?: string | null;
};

// ---- helpers ----
function nowIso() {
  return new Date().toISOString();
}

function toNumberOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseMaybeJSON<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return raw as T;
}

// ==== GET: список кампаній (простий) ====
export async function GET(req: Request) {
  await assertAdmin(req);
  const ids = (await kvZRange("campaigns:index", 0, -1)) as string[] | undefined;
  const out: StoredCampaign[] = [];

  for (const id of ids ?? []) {
    const raw = await kvGet(`campaigns:${id}`);
    const c = parseMaybeJSON<StoredCampaign>(raw);
    if (c) out.push(c);
  }

  return NextResponse.json({ total: out.length, data: out });
}

// ==== POST: створення кампанії з перевіркою унікальності варіантів ====
export async function POST(req: Request) {
  await assertAdmin(req);

  let body: CampaignDTO;
  try {
    body = (await req.json()) as CampaignDTO;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // валідація мінімально потрібних полів
  if (!body?.name?.trim()) {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  }
  const p = toNumberOrNull(body.base_pipeline_id);
  const s = toNumberOrNull(body.base_status_id);
  if (!p || !s) {
    return NextResponse.json(
      { ok: false, error: "base_pipeline_id and base_status_id must be numeric" },
      { status: 400 }
    );
  }

  // V1 має бути заданий і не порожній (за нашими правилами)
  const v1 = body.rules?.v1;
  if (!v1 || !v1.value || !v1.value.trim()) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  // === головне: перевірка унікальності варіантів серед усіх НЕвидалених кампаній ===
  try {
    await assertVariantsUniqueOrThrow({
      v1: body.rules?.v1,
      v2: body.rules?.v2,
      // excludeId не вказуємо — ми створюємо нову кампанію
    });
  } catch (e: any) {
    const status = e?.status ?? 409;
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Variants are not unique",
        conflicts: e?.conflicts,
      },
      { status }
    );
  }

  // генеруємо id (через KV incr; fallback — timestamp)
  let id: number | string;
  try {
    id = await kvIncr("campaigns:seq");
  } catch {
    id = Date.now();
  }

  const created: StoredCampaign = {
    id,
    name: body.name.trim(),
    active: body.active ?? true,
    base_pipeline_id: p,
    base_status_id: s,
    v1_count: body.v1_count ?? 0,
    v2_count: body.v2_count ?? 0,
    exp_count: body.exp_count ?? 0,
    exp_days: body.exp_days ?? undefined,
    exp_to_pipeline_id: body.exp_to_pipeline_id ?? undefined,
    exp_to_status_id: body.exp_to_status_id ?? undefined,
    rules: {
      v1: body.rules?.v1,
      v2: body.rules?.v2,
    },
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted: false,
    deleted_at: null,
    status: null,
  };

  // зберігаємо
  await kvSet(`campaigns:${id}`, created);
  await kvZAdd("campaigns:index", Date.now(), String(id));

  // відповідь
  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}

/**
 * Примітка:
 * - PUT/PATCH для редагування з перевіркою унікальності (з excludeId) додамо наступним кроком.
 * - Для DELETE ми ставимо прапорець deleted/deleted_at і НЕ прибираємо з index (або можемо — залежить від вашої політики архівації).
 *   Механізм унікальності ігнорує такі кампанії (див. campaigns-unique.ts).
 */
