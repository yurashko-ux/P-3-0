// web/app/api/campaigns/create/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZAdd } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

export const dynamic = "force-dynamic";

/* ---- невеличкий guard: приймаємо ADMIN_PASS з header/cookie/query ---- */
function isAdmin(req: Request) {
  const url = new URL(req.url);
  const qp = url.searchParams.get("admin") || url.searchParams.get("token");
  const hdr = req.headers.get("authorization") || "";
  const cookie = req.headers.get("cookie") || "";
  const pass = process.env.ADMIN_PASS;

  if (!pass) return true; // якщо не налаштовано — не блокуємо
  if (qp && qp === pass) return true;
  if (/^Bearer\s+/i.test(hdr) && hdr.replace(/^Bearer\s+/i, "") === pass) return true;
  if (cookie.includes(`admin_pass=${pass}`)) return true;
  return false;
}

/* ---- типи для валідації ---- */
type VariantRule = {
  enabled?: boolean;
  field?: "text";
  op?: "contains" | "equals";
  value?: string;
};

type CampaignIn = {
  name: string;
  base_pipeline_id: number | string;
  base_status_id: number | string;
  rules: { v1: VariantRule; v2?: VariantRule };
  exp?: { days?: number; to_pipeline_id?: number | string; to_status_id?: number | string };
};

type Campaign = CampaignIn & {
  id: number;
  created_at: string;
  updated_at: string;
  active?: boolean;
  deleted?: boolean;
  counters?: { v1_count?: number; v2_count?: number; exp_count?: number };
};

export async function POST(req: Request) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: CampaignIn | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // базова валідація
  const name = String(body?.name ?? "").trim();
  const p = Number(body?.base_pipeline_id);
  const s = Number(body?.base_status_id);
  const v1 = body?.rules?.v1;

  if (!name) return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  if (!Number.isFinite(p)) return NextResponse.json({ ok: false, error: "base_pipeline_id is required" }, { status: 400 });
  if (!Number.isFinite(s)) return NextResponse.json({ ok: false, error: "base_status_id is required" }, { status: 400 });
  if (!v1 || !v1.value || !String(v1.value).trim()) {
    return NextResponse.json({ ok: false, error: "rules.v1.value is required (non-empty)" }, { status: 400 });
  }

  // унікальність варіантів по всіх НЕ видалених кампаніях
  await assertVariantsUniqueOrThrow({
    v1: body.rules.v1,
    v2: body.rules?.v2,
    // excludeId не передаємо — ми створюємо нову
  });

  const id = Date.now(); // простий унікальний числовий id
  const nowIso = new Date().toISOString();

  const created: Campaign = {
    id,
    name,
    base_pipeline_id: p,
    base_status_id: s,
    rules: {
      v1: {
        enabled: body.rules.v1.enabled ?? true,
        field: "text",
        op: body.rules.v1.op ?? "contains",
        value: String(body.rules.v1.value).trim(),
      },
      ...(body.rules?.v2 && body.rules.v2.value
        ? {
            v2: {
              enabled: body.rules.v2.enabled ?? true,
              field: "text",
              op: body.rules.v2.op ?? "contains",
              value: String(body.rules.v2.value).trim(),
            },
          }
        : {}),
    },
    exp: body.exp
      ? {
          days: body.exp.days ?? undefined,
          to_pipeline_id: body.exp.to_pipeline_id ? Number(body.exp.to_pipeline_id) : undefined,
          to_status_id: body.exp.to_status_id ? Number(body.exp.to_status_id) : undefined,
        }
      : undefined,
    counters: { v1_count: 0, v2_count: 0, exp_count: 0 },
    active: true,
    deleted: false,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // зберегти в KV
  await kvSet(`campaigns:${id}`, created);
  await kvZAdd("campaigns:index", Date.now(), String(id));

  // повернути відповідь
  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
