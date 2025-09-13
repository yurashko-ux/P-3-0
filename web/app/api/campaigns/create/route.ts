// web/app/api/campaigns/create/route.ts
import { NextResponse } from "next/server";
import { kvSet, kvZAdd } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

export const dynamic = "force-dynamic";

/* ---- простий admin guard ---- */
function isAdmin(req: Request) {
  const url = new URL(req.url);
  const qp = url.searchParams.get("admin") || url.searchParams.get("token");
  const hdr = req.headers.get("authorization") || "";
  const cookie = req.headers.get("cookie") || "";
  const pass = process.env.ADMIN_PASS;

  if (!pass) return true;
  if (qp && qp === pass) return true;
  if (/^Bearer\s+/i.test(hdr) && hdr.replace(/^Bearer\s+/i, "") === pass) return true;
  if (cookie.includes(`admin_pass=${pass}`)) return true;
  return false;
}

/* ---- типи ---- */
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
  exp?: {
    days?: number;
    to_pipeline_id?: number | string;
    to_status_id?: number | string;
  };
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const body = (raw as Partial<CampaignIn>) || {};

  // безпечне зняття полів
  const name = String(body.name ?? "").trim();
  const basePipelineId = Number(body.base_pipeline_id);
  const baseStatusId = Number(body.base_status_id);
  const rulesV1: VariantRule | undefined = body.rules?.v1;
  const rulesV2: VariantRule | undefined = body.rules?.v2;

  // базова валідація
  if (!name) {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  }
  if (!Number.isFinite(basePipelineId)) {
    return NextResponse.json({ ok: false, error: "base_pipeline_id is required" }, { status: 400 });
  }
  if (!Number.isFinite(baseStatusId)) {
    return NextResponse.json({ ok: false, error: "base_status_id is required" }, { status: 400 });
  }
  if (!rulesV1 || !rulesV1.value || !String(rulesV1.value).trim()) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  // перевірка унікальності варіантів по всіх НЕ-видалених кампаніях
  await assertVariantsUniqueOrThrow({
    v1: rulesV1,
    v2: rulesV2,
  });

  const id = Date.now();
  const nowIso = new Date().toISOString();

  const created: Campaign = {
    id,
    name,
    base_pipeline_id: basePipelineId,
    base_status_id: baseStatusId,
    rules: {
      v1: {
        enabled: rulesV1.enabled ?? true,
        field: "text",
        op: rulesV1.op ?? "contains",
        value: String(rulesV1.value).trim(),
      },
      ...(rulesV2 && rulesV2.value
        ? {
            v2: {
              enabled: rulesV2.enabled ?? true,
              field: "text",
              op: rulesV2.op ?? "contains",
              value: String(rulesV2.value).trim(),
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

  // KV приймає string → серіалізуємо
  await kvSet(`campaigns:${id}`, JSON.stringify(created));
  await kvZAdd("campaigns:index", Date.now(), String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
