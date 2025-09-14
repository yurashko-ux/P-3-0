// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange, kvIncr } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

export const dynamic = "force-dynamic";

/* ───────── helpers ───────── */
const toInt = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const toText = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  const s = typeof v === "string" ? v : String(v);
  const t = s.trim();
  return t.length ? t : undefined;
};
const pickFirst = (...vals: unknown[]) =>
  vals.find((x) => x !== undefined && x !== null);

/** Читаємо тіло з підтримкою JSON, x-www-form-urlencoded, multipart/form-data */
async function readBody(req: Request) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  // JSON
  if (ct.includes("application/json")) {
    try {
      return await req.json();
    } catch {}
  }

  // x-www-form-urlencoded
  if (ct.includes("application/x-www-form-urlencoded")) {
    const raw = await req.text();
    const p = new URLSearchParams(raw);
    const get = (k: string) => p.get(k);

    const out: any = {
      name: toText(get("name") || get("title")),
      base_pipeline_id:
        toInt(get("base_pipeline_id") || get("pipeline_id") || get("base_pipeline")) ??
        undefined,
      base_status_id:
        toInt(get("base_status_id") || get("status_id") || get("base_status")) ??
        undefined,
      rules: {
        v1: {
          field: "text",
          op: (toText(get("rules.v1.op") || get("v1_op")) as any) || "contains",
          value:
            toText(
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
      toText(
        get("rules.v2.value") ||
          get("v2") ||
          get("v2_value") ||
          get("variant2") ||
          get("variant_v2")
      ) || "";
    if (v2val) {
      out.rules.v2 = {
        field: "text",
        op: (toText(get("rules.v2.op") || get("v2_op")) as any) || "contains",
        value: v2val,
      };
    }

    const expDays =
      toInt(get("exp_days") || get("expire_days") || get("days") || get("expire.days")) ??
      undefined;
    if (expDays) {
      out.rules.exp = {
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

    return out;
  }

  // multipart/form-data
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const get = (k: string) => {
      const v = fd.get(k);
      return typeof v === "string" ? v : v?.toString() ?? null;
    };

    const out: any = {
      name: toText(get("name") || get("title")),
      base_pipeline_id:
        toInt(get("base_pipeline_id") || get("pipeline_id") || get("base_pipeline")) ??
        undefined,
      base_status_id:
        toInt(get("base_status_id") || get("status_id") || get("base_status")) ??
        undefined,
      rules: {
        v1: {
          field: "text",
          op: (toText(get("rules.v1.op") || get("v1_op")) as any) || "contains",
          value:
            toText(
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
      toText(
        get("rules.v2.value") ||
          get("v2") ||
          get("v2_value") ||
          get("variant2") ||
          get("variant_v2")
      ) || "";
    if (v2val) {
      out.rules.v2 = {
        field: "text",
        op: (toText(get("rules.v2.op") || get("v2_op")) as any) || "contains",
        value: v2val,
      };
    }

    const expDays =
      toInt(get("exp_days") || get("expire_days") || get("days") || get("expire.days")) ??
      undefined;
    if (expDays) {
      out.rules.exp = {
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

    return out;
  }

  // fallback
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/* ───────── GET: list campaigns ───────── */
export async function GET(req: Request) {
  await assertAdmin(req);

  // 1) основний шлях — через індекс
  let ids = (await kvZRange("campaigns:index", 0, -1)) as string[] | null;

  // 2) fallback — якщо індекс порожній, скануємо 1..next_id
  if (!ids || ids.length === 0) {
    const nextRaw = (await kvGet("campaigns:next_id")) as string | null;
    const next = Number(nextRaw ?? 0);
    const scanIds: string[] = [];
    for (let i = 1; i <= next; i++) {
      const raw = (await kvGet(`campaigns:${i}`)) as string | null;
      if (raw) scanIds.push(String(i));
    }
    ids = scanIds;
  }

  const out: any[] = [];
  for (const id of ids || []) {
    const raw = (await kvGet(`campaigns:${id}`)) as string | null;
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {}
  }

  // новіші — вище
  out.sort((a, b) => (b?.created_at || "").localeCompare(a?.created_at || ""));

  return NextResponse.json({ ok: true, data: out });
}

/* ───────── POST: create campaign ───────── */
export async function POST(req: Request) {
  await assertAdmin(req);

  const body: any = await readBody(req);
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  // Нормалізація правил (включно з альтернативними ключами)
  const v1Raw = pickFirst(
    body?.rules?.v1?.value,
    body?.v1,
    body?.v1_value,
    body?.variant1,
    body?.variant_v1,
    body?.["rules.v1.value"]
  );
  const v1OpRaw = pickFirst(
    body?.rules?.v1?.op,
    body?.v1_op,
    body?.["rules.v1.op"],
    "contains"
  );
  const v2Raw = pickFirst(
    body?.rules?.v2?.value,
    body?.v2,
    body?.v2_value,
    body?.variant2,
    body?.variant_v2,
    body?.["rules.v2.value"]
  );
  const v2OpRaw = pickFirst(
    body?.rules?.v2?.op,
    body?.v2_op,
    body?.["rules.v2.op"],
    "contains"
  );

  const v1Value = toText(v1Raw);
  const v1Op = (toText(v1OpRaw) as any) || "contains";
  if (!v1Value) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  const v2Value = toText(v2Raw);
  const v2Op = (toText(v2OpRaw) as any) || "contains";

  // Перевірка унікальності варіантів серед НЕ видалених кампаній
  await assertVariantsUniqueOrThrow({
    v1: { field: "text", op: v1Op, value: v1Value },
    v2: v2Value ? { field: "text", op: v2Op, value: v2Value } : undefined,
  });

  const id = await kvIncr("campaigns:next_id");

  const created = {
    id,
    name: body.name || `Campaign #${id}`,
    active: body.active !== false,
    base_pipeline_id: Number(
      pickFirst(body.base_pipeline_id, body.pipeline_id, body.base_pipeline)
    ),
    base_status_id: Number(
      pickFirst(body.base_status_id, body.status_id, body.base_status)
    ),
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

  // Зберігаємо як JSON-рядок
  await kvSet(`campaigns:${id}`, JSON.stringify(created));

  // Додаємо до індексу (якщо індекс десь «ламається», GET має fallback)
  await kvZAdd("campaigns:index", Date.now(), String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
