// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";
import {
  assertVariantsUniqueOrThrow,
  type VariantRule,
} from "@/lib/campaigns-unique";

export const dynamic = "force-dynamic";

/** ─────────────────────────── Admin guard (inline) ─────────────────────────── */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(/;\s*/);
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function extractAdminPass(req: Request): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("admin");
  if (q) return q;

  const auth = req.headers.get("authorization");
  if (auth && /^bearer /i.test(auth)) return auth.replace(/^bearer /i, "").trim();

  const x = req.headers.get("x-admin-pass");
  if (x) return x;

  const cookieHeader = req.headers.get("cookie");
  const c = readCookie(cookieHeader, "admin_pass");
  if (c) return c;

  return null;
}

function ensureAdmin(req: Request) {
  const want = process.env.ADMIN_PASS;
  const got = extractAdminPass(req);
  if (!want || got !== want) {
    throw new Error("Unauthorized");
  }
}

/** ─────────────────────────────── Types ─────────────────────────────── */
type CampaignDTO = {
  name: string;
  active?: boolean;

  base_pipeline_id: number | string;
  base_status_id: number | string;

  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

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

/** ───────────────────────────── Helpers ───────────────────────────── */
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

/** ───────────────────────────── GET ───────────────────────────── */
export async function GET(req: Request) {
  try {
    ensureAdmin(req);
    const ids = (await kvZRange("campaigns:index", 0, -1)) as string[] | undefined;
    const out: StoredCampaign[] = [];

    for (const id of ids ?? []) {
      const raw = await kvGet(`campaigns:${id}`);
      const c = parseMaybeJSON<StoredCampaign>(raw);
      if (c) out.push(c);
    }

    return NextResponse.json({ total: out.length, data: out });
  } catch (e: any) {
    const msg = e?.message || "failed";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

/** ───────────────────────────── POST (create) ───────────────────────────── */
export async function POST(req: Request) {
  try {
    ensureAdmin(req);

    let body: CampaignDTO;
    try {
      body = (await req.json()) as CampaignDTO;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

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

    const v1 = body.rules?.v1;
    if (!v1 || !v1.value || !v1.value.trim()) {
      return NextResponse.json(
        { ok: false, error: "rules.v1.value is required (non-empty)" },
        { status: 400 }
      );
    }

    // Головне: перевірка унікальності варіантів серед усіх НЕвидалених кампаній
    await assertVariantsUniqueOrThrow({
      v1: body.rules?.v1,
      v2: body.rules?.v2,
      // excludeId: відсутній — створення нової
    });

    // Генерація id без kvIncr (простий варіант для MVP)
    const id: number | string = Date.now();

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

    await kvSet(`campaigns:${id}`, created);
    await kvZAdd("campaigns:index", Date.now(), String(id));

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message || "failed";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
