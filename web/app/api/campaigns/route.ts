// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

/* ====================== ЛОКАЛЬНІ ХЕЛПЕРИ ====================== */

// Проста адмін-перевірка по ADMIN_PASS: Authorization: Bearer, X-Admin-Pass, cookie admin_pass, ?admin=
async function assertAdminLocal(req: Request) {
  const PASS = process.env.ADMIN_PASS || "";
  if (!PASS) return; // якщо не задано — не блокуємо (щоб не падати на прев'ю)
  const u = new URL(req.url);
  const hdr = req.headers.get("authorization") || "";
  const bearer = hdr.toLowerCase().startsWith("bearer ")
    ? hdr.slice(7)
    : undefined;
  const headerAlt = req.headers.get("x-admin-pass") || undefined;
  const queryAlt = u.searchParams.get("admin") || undefined;

  // cookie (raw)
  const cookie = req.headers.get("cookie") || "";
  const cookiePass = cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("admin_pass="))
    ?.split("=")[1];

  const got = bearer || headerAlt || queryAlt || cookiePass;
  if (got !== PASS) {
    throw new Error("unauthorized");
  }
}

function toStringOrUndefined(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v);
  return s;
}

type Rule = {
  enabled?: boolean;
  field?: "text";
  op?: "contains" | "equals";
  value?: string;
};

type Campaign = {
  id: number;
  name: string;

  base_pipeline_id: number;
  base_status_id: number;

  v1_pipeline_id: number | null;
  v1_status_id: number | null;

  v2_pipeline_id: number | null;
  v2_status_id: number | null;

  exp_days?: number | null;
  exp_to_pipeline_id?: number | null;
  exp_to_status_id?: number | null;

  rules: { v1: Rule; v2?: Rule };

  active?: boolean;
  created_at?: string;
  updated_at?: string;

  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Толерантна нормалізація payload'а з форми
function normalizeIncoming(body: any) {
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
    v2Value && v2Value.trim() !== ""
      ? {
          enabled: body?.rules?.v2?.enabled ?? true,
          field: "text",
          op: (body?.rules?.v2?.op as Rule["op"]) ?? "equals",
          value: v2Value,
        }
      : undefined;

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

/* ====================== HANDLERS ====================== */

export async function GET() {
  const ids = (await kvZRange("campaigns:index", 0, -1)) as string[]; // порядок не критичний
  const out: Campaign[] = [];
  for (const id of ids || []) {
    const row = await kvGet(`campaigns:${id}`);
    if (row) out.push(row as Campaign);
  }
  return NextResponse.json({ ok: true, data: out });
}

export async function POST(req: Request) {
  try {
    await assertAdminLocal(req);

    const body = await req.json().catch(() => ({}));
    const candidate = normalizeIncoming(body);

    if (!candidate.base_pipeline_id || !candidate.base_status_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "base_pipeline_id & base_status_id are required",
        },
        { status: 400 }
      );
    }
    if (!candidate.rules?.v1?.value || candidate.rules.v1.value.trim() === "") {
      return NextResponse.json(
        { ok: false, error: "rules.v1.value is required (non-empty)" },
        { status: 400 }
      );
    }

    // Перевірка унікальності значень варіантів серед усіх не видалених кампаній
    await assertVariantsUniqueOrThrow({
      id: undefined,
      v1: candidate.rules.v1.value!,
      v2: candidate.rules?.v2?.value || undefined,
    });

    const id = Date.now();
    const created: Campaign = {
      id,
      ...candidate,
    };

    // kvSet може мати сигнатуру (key, string), тому приводимо тип до any — у вашому kv він серіалізується як JSON
    await kvSet(`campaigns:${id}`, created as any);
    await kvZAdd("campaigns:index", Date.now(), String(id));

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (e: any) {
    const status = e?.message === "unauthorized" ? 401 : 500;
    const msg =
      e?.message ||
      e?.toString?.() ||
      "failed to create campaign (unexpected error)";
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
