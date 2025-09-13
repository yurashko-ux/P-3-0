// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

/* ------------------------------------------------
   допоміжні
-------------------------------------------------*/
function bad(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function safeJson<T = any>(req: Request): Promise<T | null> {
  try {
    // якщо порожнє тіло — вертаємо null
    const txt = await req.text();
    if (!txt) return null;
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function nonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

/* ------------------------------------------------
   GET  /api/campaigns — список
-------------------------------------------------*/
export async function GET(req: Request) {
  await assertAdmin(req);

  const ids = await kvZRange("campaigns:index", 0, -1);
  const out: any[] = [];
  for (const id of ids || []) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    try {
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      out.push(c);
    } catch {
      // ігноруємо биті записи
    }
  }
  return NextResponse.json({ ok: true, data: out });
}

/* ------------------------------------------------
   POST /api/campaigns — створення
-------------------------------------------------*/
export async function POST(req: Request) {
  try {
    await assertAdmin(req);

    const body = await safeJson<any>(req);
    if (!body) return bad(400, "empty body");

    // базові обов'язкові поля
    const name = body.name;
    const base_pipeline_id = Number(body.base_pipeline_id);
    const base_status_id = Number(body.base_status_id);
    if (!nonEmptyString(name)) return bad(400, "name is required");
    if (!Number.isFinite(base_pipeline_id)) return bad(400, "base_pipeline_id is required (number)");
    if (!Number.isFinite(base_status_id)) return bad(400, "base_status_id is required (number)");

    // правила
    const v1 = body.rules?.v1 ?? {};
    const v2 = body.rules?.v2 ?? undefined;

    // V1 обов'язковий: value — non-empty
    if (!nonEmptyString(v1.value)) {
      return bad(400, "rules.v1.value is required (non-empty)");
    }
    const ruleV1 = {
      field: "text",
      op: v1.op === "equals" ? "equals" : "contains",
      value: String(v1.value).trim(),
      pipeline_id: Number(v1.pipeline_id),
      status_id: Number(v1.status_id),
    };
    if (!Number.isFinite(ruleV1.pipeline_id) || !Number.isFinite(ruleV1.status_id)) {
      return bad(400, "rules.v1.pipeline_id & rules.v1.status_id are required (numbers)");
    }

    // V2 — опційний: приймаємо лише якщо value непорожній
    let ruleV2:
      | {
          field: "text";
          op: "contains" | "equals";
          value: string;
          pipeline_id: number;
          status_id: number;
        }
      | undefined;

    if (v2 && nonEmptyString(v2.value)) {
      ruleV2 = {
        field: "text",
        op: v2.op === "equals" ? "equals" : "contains",
        value: String(v2.value).trim(),
        pipeline_id: Number(v2.pipeline_id),
        status_id: Number(v2.status_id),
      };
      if (!Number.isFinite(ruleV2.pipeline_id) || !Number.isFinite(ruleV2.status_id)) {
        return bad(400, "rules.v2.pipeline_id & rules.v2.status_id must be numbers when v2.value is set");
      }
    }

    // expire
    const exp_days = Number(body.expire?.days ?? body.exp_days ?? 0);
    const exp_to_pipeline_id = Number(body.expire?.pipeline_id ?? body.exp_to_pipeline_id ?? NaN);
    const exp_to_status_id = Number(body.expire?.status_id ?? body.exp_to_status_id ?? NaN);
    if (!Number.isFinite(exp_days) || exp_days < 0) return bad(400, "expire.days must be a non-negative number");
    if (!Number.isFinite(exp_to_pipeline_id) || !Number.isFinite(exp_to_status_id)) {
      return bad(400, "expire.pipeline_id & expire.status_id are required (numbers)");
    }

    // унікальність варіантів по всіх НЕ видалених кампаніях
    await assertVariantsUniqueOrThrow({
      v1: { field: "text", op: ruleV1.op, value: ruleV1.value },
      v2: ruleV2 ? { field: "text", op: ruleV2.op, value: ruleV2.value } : undefined,
    });

    // формуємо збережений об'єкт
    const id = Date.now(); // достатньо для id; індексуємось все одно по ZSET
    const nowIso = new Date().toISOString();
    const created = {
      id,
      name: String(name).trim(),
      base_pipeline_id,
      base_status_id,
      active: true,
      rules: {
        v1: ruleV1,
        v2: ruleV2,
      },
      expire: {
        days: exp_days,
        pipeline_id: exp_to_pipeline_id,
        status_id: exp_to_status_id,
      },
      // лічильники за замовчуванням
      metrics: { v1_count: 0, v2_count: 0, exp_count: 0 },
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null as string | null,
    };

    // збереження: kvSet може приймати об'єкт — обгортка сама stringify-ить
    await kvSet(`campaigns:${id}`, created);
    await kvZAdd("campaigns:index", Date.now(), String(id));

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (e: any) {
    console.error("Create campaign failed:", e);
    // якщо наша валідація кинула message/status — покажемо їх
    const status = Number(e?.status || 500);
    const msg = String(e?.message || "internal error");
    return bad(status, msg);
  }
}
