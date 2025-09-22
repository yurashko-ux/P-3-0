// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

type Rule = { op?: "contains" | "equals"; value?: string };

type Campaign = {
  id: string;
  name?: string;

  // V1 (base)
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  // rules
  rules?: { v1?: Rule; v2?: Rule };

  // experiment
  exp?: {
    to_pipeline_id?: number;
    to_status_id?: number;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
    trigger?: Rule;
  };

  // diagnostics
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  created_at?: number;
  active?: boolean;
};

const NS = "campaigns";
const INDEX_KEY = `${NS}:index`;
const ITEM_KEY = (id: string) => `${NS}:${id}`;

function nowTs() {
  return Date.now();
}

function coerceNum(n: any): number | undefined {
  if (n === null || n === undefined || n === "") return undefined;
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

function trimOrNull(s: any): string | null | undefined {
  if (s === null || s === undefined) return undefined;
  const t = String(s).trim();
  return t.length ? t : null;
}

function sanitizeInput(body: any): Omit<Campaign, "id"> {
  const base_pipeline_id = coerceNum(body.base_pipeline_id);
  const base_status_id = coerceNum(body.base_status_id);

  const base_pipeline_name = trimOrNull(body.base_pipeline_name);
  const base_status_name = trimOrNull(body.base_status_name);

  const v1: Rule | undefined =
    body?.rules?.v1 || body.v1
      ? {
          op: (body?.rules?.v1?.op || body?.v1?.op || "contains") as
            | "contains"
            | "equals",
          value:
            trimOrNull(body?.rules?.v1?.value ?? body?.v1?.value) ?? undefined,
        }
      : undefined;

  const v2: Rule | undefined =
    body?.rules?.v2 || body.v2
      ? {
          op: (body?.rules?.v2?.op || body?.v2?.op || "contains") as
            | "contains"
            | "equals",
          value:
            trimOrNull(body?.rules?.v2?.value ?? body?.v2?.value) ?? undefined,
        }
      : undefined;

  const exp_to_pipeline_id = coerceNum(body?.exp?.to_pipeline_id ?? body?.to_pipeline_id);
  const exp_to_status_id = coerceNum(body?.exp?.to_status_id ?? body?.to_status_id);
  const exp_to_pipeline_name = trimOrNull(
    body?.exp?.to_pipeline_name ?? body?.to_pipeline_name
  );
  const exp_to_status_name = trimOrNull(
    body?.exp?.to_status_name ?? body?.to_status_name
  );
  const exp_trigger: Rule | undefined =
    body?.exp?.trigger || body?.exp_trigger
      ? {
          op: (body?.exp?.trigger?.op || body?.exp_trigger?.op || "contains") as
            | "contains"
            | "equals",
          value:
            trimOrNull(
              body?.exp?.trigger?.value ?? body?.exp_trigger?.value
            ) ?? undefined,
        }
      : undefined;

  const name = trimOrNull(body.name) ?? undefined;

  // збираємо структуру
  const result: Omit<Campaign, "id"> = {
    name,
    base_pipeline_id,
    base_status_id,
    base_pipeline_name,
    base_status_name,
    rules: v1 || v2 ? { v1, v2 } : undefined,
    exp:
      exp_to_pipeline_id ||
      exp_to_status_id ||
      exp_to_pipeline_name ||
      exp_to_status_name ||
      exp_trigger
        ? {
            to_pipeline_id: exp_to_pipeline_id,
            to_status_id: exp_to_status_id,
            to_pipeline_name: exp_to_pipeline_name,
            to_status_name: exp_to_status_name,
            trigger: exp_trigger,
          }
        : undefined,
    active: body.active === false ? false : true,
    created_at: nowTs(),
  };

  return result;
}

// GET /api/campaigns — список
export async function GET() {
  try {
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
    const items: Campaign[] = [];
    for (const id of ids || []) {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Campaign;
        items.push(parsed);
      } catch {
        // skip broken
      }
    }

    return NextResponse.json(
      {
        ok: true,
        count: items.length,
        items,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }
}

// POST /api/campaigns — створення
export async function POST(req: Request) {
  try {
    // auth (проста перевірка токена)
    const token = req.headers.get("x-admin-token") || "";
    const expect = process.env.ADMIN_TOKEN || process.env.NEXT_PUBLIC_ADMIN_TOKEN || "";
    if (!expect || token !== expect) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized: missing or invalid admin token" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const data = sanitizeInput(body);

    const id = (body.id && String(body.id)) || `${Date.now()}`;
    const item: Campaign = { id, ...data };

    // збереження
    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    await redis.zadd(INDEX_KEY, item.created_at || nowTs(), id);

    return NextResponse.json(
      { ok: true, id, item },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }
}
