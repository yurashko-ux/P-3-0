// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { redis } from "../../../lib/redis";

export const dynamic = "force-dynamic";

type Rule = { op?: "contains" | "equals"; value?: string };
type Campaign = {
  id: string;
  name?: string;

  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  rules?: { v1?: Rule; v2?: Rule };

  exp?: {
    to_pipeline_id?: number;
    to_status_id?: number;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
    trigger?: Rule;
  };

  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  created_at?: number;
  active?: boolean;
};

const LIST_KEY = "campaigns:ids";
const ITEM_KEY = (id: string) => `campaigns:${id}`;

// --- helpers ---
function isAdmin(req: Request) {
  const hdr = req.headers.get("x-admin-token") || req.headers.get("X-Admin-Token");
  const env = process.env.ADMIN_TOKEN;
  return !!env && hdr === env;
}

async function readAll(): Promise<Campaign[]> {
  // 1) основне джерело — звичайний список
  let ids: string[] = [];
  try {
    ids = await redis.lrange(LIST_KEY, 0, -1);
  } catch {}

  // 2) fallback: якщо список порожній, пробуємо старий індекс у ZSET без "options"
  if (!ids.length) {
    try {
      const zIds = (await (redis as any).zrange("campaigns:index", 0, -1)) as string[];
      if (Array.isArray(zIds)) ids = zIds;
    } catch {
      // ігноруємо помилку — Upstash REST може не приймати такі варіанти
    }
  }

  // 3) зчитуємо предмети (без MGET, щоб уникнути несумісних команд)
  const items: Campaign[] = [];
  for (const id of ids) {
    try {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Campaign;
      items.push(parsed);
    } catch {
      // пропускаємо биті записи
    }
  }

  // 4) сортуємо за часом створення (нові зверху)
  items.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return items;
}

// --- GET /api/campaigns ---
export async function GET() {
  try {
    const items = await readAll();
    return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "KV error: " + (e?.message || String(e)) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// --- POST /api/campaigns ---
export async function POST(req: Request) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized: missing or invalid admin token" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Partial<Campaign>;
    const now = Date.now();
    const id = (body.id as string) || String(now);

    const item: Campaign = {
      id,
      name: body.name ?? "",

      base_pipeline_id: body.base_pipeline_id,
      base_status_id: body.base_status_id,
      base_pipeline_name: body.base_pipeline_name ?? null,
      base_status_name: body.base_status_name ?? null,

      rules: {
        v1: body.rules?.v1 ?? { op: "contains", value: "" },
        v2: body.rules?.v2, // може бути undefined — ок
      },

      exp: body.exp
        ? {
            to_pipeline_id: body.exp.to_pipeline_id,
            to_status_id: body.exp.to_status_id,
            to_pipeline_name: body.exp.to_pipeline_name ?? null,
            to_status_name: body.exp.to_status_name ?? null,
            trigger: body.exp.trigger,
          }
        : undefined,

      v1_count: body.v1_count ?? 0,
      v2_count: body.v2_count ?? 0,
      exp_count: body.exp_count ?? 0,

      created_at: body.created_at ?? now,
      active: body.active ?? true,
    };

    // записуємо сам об'єкт
    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    // додаємо id у LIST-індекс (нові — ліворуч)
    await redis.lpush(LIST_KEY, id);

    return NextResponse.json({ ok: true, created: id }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "KV error: " + (e?.message || String(e)) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
