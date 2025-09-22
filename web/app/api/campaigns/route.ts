// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

type Rule = { op?: "contains" | "equals"; value?: string };
type Campaign = {
  id: string;
  name?: string;

  // base pair (V1 base)
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  // rules
  rules?: { v1?: Rule; v2?: Rule };

  // experiment (EXP) target + optional trigger rule
  exp?: {
    to_pipeline_id?: number;
    to_status_id?: number;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
    trigger?: Rule;
  };

  // counters
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  // meta
  created_at?: number;
  active?: boolean;
};

const NS = "campaigns";
const INDEX_KEY = `${NS}:index`;
const ITEM_KEY = (id: string) => `${NS}:${id}`;

/** ===== Helpers ===== */

function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...((data as any) ?? {}) }, init);
}
function fail(status: number, error: string, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

/** Перевірка адмін-токена: потрібна ТІЛЬКИ для методів, що змінюють дані */
function isWriteMethod(method: string) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}
function readIncomingToken(req: Request) {
  const u = new URL(req.url);
  return (
    req.headers.get("x-admin-token") ||
    u.searchParams.get("admin") ||
    u.searchParams.get("token")
  );
}
function checkAdmin(req: Request) {
  if (!isWriteMethod(req.method)) return { ok: true };
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return { ok: true }; // якщо токен не налаштований — не блокуємо
  const provided = readIncomingToken(req);
  if (provided && provided === expected) return { ok: true };
  return { ok: false, status: 401 as const, error: "Unauthorized: missing or invalid admin token" };
}

/** Normalization for incoming payload */
function normalizeCampaign(input: any): Campaign {
  const now = Date.now();
  const id: string = String(input?.id ?? now);

  const numOrUndef = (x: any) =>
    x === null || x === undefined || x === "" ? undefined : Number(x);

  const rule = (r: any): Rule | undefined => {
    if (!r) return undefined;
    const value = r.value ?? r?.val ?? r?.text ?? r?.title;
    const op = r.op === "equals" ? "equals" : "contains";
    if (!value) return undefined;
    return { op, value: String(value) };
  };

  return {
    id,
    name: input?.name ?? input?.title ?? `Campaign ${id}`,
    base_pipeline_id: numOrUndef(input?.base_pipeline_id),
    base_status_id: numOrUndef(input?.base_status_id),
    base_pipeline_name: input?.base_pipeline_name ?? null,
    base_status_name: input?.base_status_name ?? null,

    rules: {
      v1: rule(input?.rules?.v1 ?? input?.v1),
      v2: rule(input?.rules?.v2 ?? input?.v2),
    },

    exp: {
      to_pipeline_id: numOrUndef(input?.exp?.to_pipeline_id ?? input?.to_pipeline_id),
      to_status_id: numOrUndef(input?.exp?.to_status_id ?? input?.to_status_id),
      to_pipeline_name: input?.exp?.to_pipeline_name ?? input?.to_pipeline_name ?? null,
      to_status_name: input?.exp?.to_status_name ?? input?.to_status_name ?? null,
      trigger: rule(input?.exp?.trigger),
    },

    v1_count: Number(input?.v1_count ?? 0),
    v2_count: Number(input?.v2_count ?? 0),
    exp_count: Number(input?.exp_count ?? 0),

    created_at: Number(input?.created_at ?? now),
    active: input?.active ?? true,
  };
}

/** ===== Handlers ===== */

// GET /api/campaigns  — ПУБЛІЧНИЙ (без токена)
export async function GET() {
  try {
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
    const items: Campaign[] = [];
    for (const id of ids || []) {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try {
        items.push(JSON.parse(raw) as Campaign);
      } catch {
        // skip broken
      }
    }
    return ok({ items, count: items.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return fail(500, "KV error: " + (e?.message || String(e)));
  }
}

// POST /api/campaigns — створення (ПОТРІБЕН токен тільки тут)
export async function POST(req: Request) {
  const auth = checkAdmin(req);
  if (!auth.ok) return fail(auth.status, auth.error);

  let input: any;
  try {
    input = await req.json();
  } catch {
    return fail(400, "Bad JSON");
  }

  const item = normalizeCampaign(input);
  const now = Date.now();

  try {
    await redis.set(ITEM_KEY(item.id), JSON.stringify(item));
    // наша обгортка підтримує об'єктний варіант { score, member }
    await redis.zadd(INDEX_KEY, { score: now, member: item.id });

    // одразу повертаємо актуальний список
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
    const items: Campaign[] = [];
    for (const id of ids || []) {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try {
        items.push(JSON.parse(raw) as Campaign);
      } catch {}
    }

    return ok(
      { created: item.id, item, items, count: items.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return fail(500, "KV error: " + (e?.message || String(e)));
  }
}
