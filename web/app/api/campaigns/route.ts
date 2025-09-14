// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRevRange } from "@/lib/kv";

// Допоміжні відповіді
function ok(data: any, status = 200) {
  return NextResponse.json(data, { status });
}
function bad(status = 400, message = "Bad Request") {
  return NextResponse.json({ error: message }, { status });
}

// Типи для наочності
type RuleOp = "contains" | "equals";
type VariantRule = { field: "text"; op: RuleOp; value: string };
type Campaign = {
  id: string;
  name: string;
  active: boolean;
  // базова пара
  base_pipeline_id: number;
  base_status_id: number;
  // правила
  rules: {
    v1: VariantRule;
    v2?: VariantRule | null;
  };
  // expire
  exp?: {
    days: number;
    to_pipeline_id: number;
    to_status_id: number;
  } | null;
  // лічильники
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
  // часові мітки
  created_at: number;
  updated_at: number;
};

/**
 * GET /api/campaigns — список кампаній
 * Головне: читаємо весь індекс через (0, -1),
 * щоб не отримати порожній результат.
 */
export async function GET(req: Request) {
  await assertAdmin(req);

  let ids: string[] = [];
  try {
    // Брати ВЕСЬ список: від 0 до -1 (усі елементи, новіші зверху)
    ids = (await kvZRevRange("campaigns:index", 0, -1)) as string[]; 
  } catch {
    ids = [];
  }

  const items: Campaign[] = [];
  for (const id of ids) {
    try {
      const c = (await kvGet(`campaigns:${id}`)) as Campaign | null;
      if (c) items.push(c);
    } catch {
      // пропускаємо биті записи
    }
  }

  return ok({ items });
}

/**
 * POST /api/campaigns — створити кампанію (щоб не ловити 405)
 * Валідація: rules.v1.value — обовʼязково непорожнє.
 */
export async function POST(req: Request) {
  await assertAdmin(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON body");
  }

  // Мінімальна валідація
  const name = String(body?.name ?? "").trim();
  const active = Boolean(body?.active ?? true);

  const base_pipeline_id = Number(body?.base_pipeline_id);
  const base_status_id = Number(body?.base_status_id);

  const v1 = body?.rules?.v1 as VariantRule | undefined;
  const v2 = (body?.rules?.v2 as VariantRule | undefined) ?? null;

  if (!v1 || typeof v1.value !== "string" || v1.value.trim() === "") {
    return bad(400, "rules.v1.value is required (non-empty)");
  }

  const exp = body?.exp
    ? {
        days: Number(body?.exp?.days ?? 0),
        to_pipeline_id: Number(body?.exp?.to_pipeline_id ?? 0),
        to_status_id: Number(body?.exp?.to_status_id ?? 0),
      }
    : null;

  const ts = Date.now();
  const id = (body?.id && String(body.id)) || `${ts}`;

  const campaign: Campaign = {
    id,
    name,
    active,
    base_pipeline_id,
    base_status_id,
    rules: {
      v1: {
        field: "text",
        op: (v1.op as RuleOp) ?? "contains",
        value: v1.value.trim(),
      },
      v2: v2
        ? {
            field: "text",
            op: (v2.op as RuleOp) ?? "contains",
            value: String(v2.value ?? "").trim(),
          }
        : null,
    },
    exp,
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
    created_at: ts,
    updated_at: ts,
  };

  try {
    await kvSet(`campaigns:${id}`, campaign);
    await kvZAdd("campaigns:index", ts, id);
  } catch (e: any) {
    return bad(500, "KV write failed");
  }

  return ok({ saved: true, campaign }, 201);
}
