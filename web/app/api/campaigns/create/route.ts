// web/app/api/campaigns/create/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange, kvIncr } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

export const dynamic = "force-dynamic";

/** helpers */
const toInt = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const clean = (s?: string | null) =>
  (typeof s === "string" ? s.trim() : "") || undefined;

/** read body in JSON, urlencoded, or multipart */
async function readBody(req: Request) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  // JSON
  if (ct.includes("application/json")) {
    try {
      return await req.json();
    } catch {}
  }

  // urlencoded
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const p = new URLSearchParams(text);
    const get = (k: string) => p.get(k);

    const body: any = {
      name: clean(get("name") || get("title")),
      base_pipeline_id:
        toInt(get("base_pipeline_id") || get("pipeline_id") || get("base_pipeline")) ??
        undefined,
      base_status_id:
        toInt(get("base_status_id") || get("status_id") || get("base_status")) ??
        undefined,
      rules: {
        v1: {
          field: "text",
          op: (clean(get("rules.v1.op") || get("v1_op")) as any) || "contains",
          value:
            clean(
              get("rules.v1.value") ||
                get("v1") ||
                get("v1_value") ||
                get("variant1") ||
                get("variant_v1")
            ) || "",
        },
      } as any,
    };

    const v2val =
      clean(
        get("rules.v2.value") ||
          get("v2") ||
          get("v2_value") ||
          get("variant2") ||
          get("variant_v2")
      ) || "";
    if (v2val) {
      body.rules.v2 = {
        field: "text",
        op: (clean(get("rules.v2.op") || get("v2_op")) as any) || "contains",
        value: v2val,
      };
    }

    const expDays =
      toInt(
        get("exp_days") ||
          get("expire_days") ||
          get("days") ||
          get("expire.days")
      ) ?? undefined;

    if (expDays) {
      body.rules.exp = {
        days: expDays,
        to_pipeline_id:
          toInt(
            get("exp_to_pipeline_id") ||
              get("expire_pipeline_id") ||
              get("exp.pipeline_id")
          ) ?? undefined,
        to_status_id:
          toInt(
            get("exp_to_status_id") ||
              get("expire_status_id") ||
              get("exp.status_id")
          ) ?? undefined,
      };
    }

    return body;
  }

  // multipart
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const get = (k: string) => {
      const v = fd.get(k);
      return typeof v === "string" ? v : v?.toString() ?? null;
    };
    const body: any = {
      name: clean(get("name") || get("title")),
      base_pipeline_id:
        toInt(get("base_pipeline_id") || get("pipeline_id") || get("base_pipeline")) ??
        undefined,
      base_status_id:
        toInt(get("base_status_id") || get("status_id") || get("base_status")) ??
        undefined,
      rules: {
        v1: {
          field: "text",
          op: (clean(get("rules.v1.op") || get("v1_op")) as any) || "contains",
          value:
            clean(
              get("rules.v1.value") ||
                get("v1") ||
                get("v1_value") ||
                get("variant1") ||
                get("variant_v1")
            ) || "",
        },
      } as any,
    };
    const v2val =
      clean(
        get("rules.v2.value") ||
          get("v2") ||
          get("v2_value") ||
          get("variant2") ||
          get("variant_v2")
      ) || "";
    if (v2val) {
      body.rules.v2 = {
        field: "text",
        op: (clean(get("rules.v2.op") || get("v2_op")) as any) || "contains",
        value: v2val,
      };
    }
    const expDays =
      toInt(
        get("exp_days") ||
          get("expire_days") ||
          get("days") ||
          get("expire.days")
      ) ?? undefined;
    if (expDays) {
      body.rules.exp = {
        days: expDays,
        to_pipeline_id:
          toInt(
            get("exp_to_pipeline_id") ||
              get("expire_pipeline_id") ||
              get("exp.pipeline_id")
          ) ?? undefined,
        to_status_id:
          toInt(
            get("exp_to_status_id") ||
              get("expire_status_id") ||
              get("exp.status_id")
          ) ?? undefined,
      };
    }
    return body;
  }

  // final fallback
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  await assertAdmin(req);

  const body: any = await readBody(req);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 }
    );
  }

  // normalize rules with sensible defaults
  const ruleV1 = body.rules?.v1 ?? {};
  const v1Value = clean(ruleV1.value);
  const v1Op = (clean(ruleV1.op) as "contains" | "equals") || "contains";
  if (!v1Value) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  const ruleV2 = body.rules?.v2;
  const v2Value = clean(ruleV2?.value);
  const v2Op = (clean(ruleV2?.op) as "contains" | "equals") || "contains";

  // uniqueness guard (по всіх не-видалених кампаніях)
  await assertVariantsUniqueOrThrow({
    v1: { field: "text", op: v1Op, value: v1Value },
    v2: v2Value ? { field: "text", op: v2Op, value: v2Value } : undefined,
  });

  // issue new id
  const id = await kvIncr("campaigns:next_id");

  const created = {
    id,
    name: body.name || `Campaign #${id}`,
    active: body.active !== false,
    base_pipeline_id: Number(body.base_pipeline_id),
    base_status_id: Number(body.base_status_id),
    rules: {
      v1: { field: "text", op: v1Op, value: v1Value },
      ...(v2Value ? { v2: { field: "text", op: v2Op, value: v2Value } } : {}),
      ...(body.rules?.exp
        ? {
            exp: {
              days: Number(body.rules.exp.days) || 0,
              to_pipeline_id: toInt(body.rules.exp.to_pipeline_id),
              to_status_id: toInt(body.rules.exp.to_status_id),
            },
          }
        : {}),
    },
    counters: { v1: 0, v2: 0, exp: 0 },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // persist
  await kvSet(`campaigns:${id}`, created);
  await kvZAdd("campaigns:index", Date.now(), String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
