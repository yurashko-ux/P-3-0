// web/app/api/campaigns/create/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";

type VariantOp = "contains" | "equals";
type Rule = { field: "text"; op: VariantOp; value: string };
type Campaign = {
  id: string;
  name: string;
  base_pipeline_id: number;
  base_status_id: number;
  rule_v1: Rule;
  rule_v2?: Rule | null;
  exp_days?: number | null;
  exp_to_pipeline_id?: number | null;
  exp_to_status_id?: number | null;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
  created_at: number;
  updated_at: number;
  deleted?: boolean;
};

function bad(status: number, message: string) {
  return new NextResponse(message, { status });
}
function okJSON(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

const isOp = (x: unknown): x is VariantOp => x === "contains" || x === "equals";
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function normalizeRule(input: any): Rule | null {
  const op = input?.op;
  const value = str(input?.value);
  if (!isOp(op)) return null;
  if (!value) return null;
  return { field: "text", op, value };
}

/** Витягує перше непорожнє значення з набору можливих ключів (для FormData) */
function pickFirst(form: FormData, keys: string[]) {
  for (const k of keys) {
    const v = form.get(k);
    if (v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

/** Уніфікація body: JSON або FormData → спільна структура */
async function readUnifiedBody(req: Request) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  // JSON
  if (ct.includes("application/json")) {
    try {
      const b = await req.json();
      return {
        name: str(b?.name),
        base_pipeline_id: num(b?.base_pipeline_id),
        base_status_id: num(b?.base_status_id),
        rule_v1: normalizeRule({
          op: b?.rules?.v1?.op ?? b?.rule_v1?.op ?? b?.v1?.op ?? b?.v1_op,
          value:
            str(b?.rules?.v1?.value ?? b?.rule_v1?.value ?? b?.v1?.value ?? b?.v1_value),
        }),
        rule_v2: (() => {
          const r = normalizeRule({
            op: b?.rules?.v2?.op ?? b?.rule_v2?.op ?? b?.v2?.op ?? b?.v2_op,
            value:
              str(b?.rules?.v2?.value ?? b?.rule_v2?.value ?? b?.v2?.value ?? b?.v2_value),
          });
          return r ?? null;
        })(),
        exp_days: num(b?.expire?.days ?? b?.exp_days),
        exp_to_pipeline_id: num(b?.expire?.to_pipeline_id ?? b?.exp_to_pipeline_id),
        exp_to_status_id: num(b?.expire?.to_status_id ?? b?.exp_to_status_id),
      };
    } catch {
      return null;
    }
  }

  // FORM (urlencoded / multipart)
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const f = await req.formData();
    const name = str(pickFirst(f, ["name"]) || "");
    const base_pipeline_id = num(pickFirst(f, ["base_pipeline_id", "pipeline_id"]));
    const base_status_id = num(pickFirst(f, ["base_status_id", "status_id"]));

    const v1_op = str(
      pickFirst(f, ["rules.v1.op", "rule_v1.op", "v1.op", "v1_op"]) || ""
    ) as VariantOp;
    const v1_value = str(
      pickFirst(f, ["rules.v1.value", "rule_v1.value", "v1.value", "v1_value"]) || ""
    );

    const v2_op = str(
      pickFirst(f, ["rules.v2.op", "rule_v2.op", "v2.op", "v2_op"]) || ""
    ) as VariantOp;
    const v2_value = str(
      pickFirst(f, ["rules.v2.value", "rule_v2.value", "v2.value", "v2_value"]) || ""
    );

    const exp_days = num(pickFirst(f, ["expire.days", "exp_days"]));
    const exp_to_pipeline_id = num(pickFirst(f, ["expire.to_pipeline_id", "exp_to_pipeline_id"]));
    const exp_to_status_id = num(pickFirst(f, ["expire.to_status_id", "exp_to_status_id"]));

    return {
      name,
      base_pipeline_id,
      base_status_id,
      rule_v1: normalizeRule({ op: v1_op, value: v1_value }),
      rule_v2: (() => {
        const r = normalizeRule({ op: v2_op, value: v2_value });
        return r ?? null;
      })(),
      exp_days,
      exp_to_pipeline_id,
      exp_to_status_id,
    };
  }

  return null;
}

export async function POST(req: Request) {
  await assertAdmin(req);

  const u = await readUnifiedBody(req);
  if (!u) return bad(400, "Invalid body (JSON or FormData required)");

  if (!u.name) return bad(400, "name is required");
  if (!u.base_pipeline_id || !u.base_status_id)
    return bad(400, "base_pipeline_id & base_status_id are required");
  if (!u.rule_v1) return bad(400, "rules.v1.value is required (non-empty)");

  const now = Date.now();
  const id = String(now);

  const campaign: Campaign = {
    id,
    name: u.name,
    base_pipeline_id: u.base_pipeline_id!,
    base_status_id: u.base_status_id!,
    rule_v1: u.rule_v1,
    rule_v2: u.rule_v2 ?? null,
    exp_days: u.exp_days ?? null,
    exp_to_pipeline_id: u.exp_to_pipeline_id ?? null,
    exp_to_status_id: u.exp_to_status_id ?? null,
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
    created_at: now,
    updated_at: now,
  };

  await kvSet(`campaigns:${id}`, campaign);
  await kvZAdd("campaigns:index", now, id);

  return okJSON({ ok: true, id, campaign }, 201);
}

/** Допоміжний GET: список (той самий формат, що і в /api/campaigns) */
export async function GET(req: Request) {
  await assertAdmin(req);
  const ids = (await kvZRange("campaigns:index", 0, -1)) ?? [];
  const out: Campaign[] = [];
  for (const id of [...ids].reverse()) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    try {
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!c?.deleted) out.push(c as Campaign);
    } catch {}
  }
  return okJSON({ items: out });
}
