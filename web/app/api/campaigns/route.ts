// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const INDEX_KEY = "campaigns:index";
const ITEM_KEY = (id: string | number) => `campaigns:${id}`;

// --- утиліти ---------------------------------------------------------------
function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  // Безпечний конструктор RegExp: екрануємо спецсимволи в імені cookie
  const escaped = name.replace(/[-.[\]{}()*+?^$|\\]/g, "\\$&");
  const m = header.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function getAdminToken(req: Request): string {
  const url = new URL(req.url);
  // 1) query
  const q = url.searchParams.get("token")?.trim();
  if (q) return q;

  // 2) header
  const h = req.headers.get("x-admin-token")?.trim();
  if (h) return h;

  // 3) cookie
  const c = parseCookie(req.headers.get("cookie"), "admin_token");
  if (c) return c.trim();

  return "";
}

function isAuthorized(token: string): boolean {
  const envToken = process.env.ADMIN_TOKEN?.trim();
  if (process.env.ALLOW_ANY_ADMIN === "true") return true; // опційний байпас для дев/стейджу
  if (!envToken) return false;
  return token === envToken;
}

// --- GET /api/campaigns ----------------------------------------------------
export async function GET(req: Request) {
  const token = getAdminToken(req);
  if (!isAuthorized(token)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: missing or invalid admin token" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    // Нові звернення у стилі Upstash REST SDK обгортки (з нашого redis.ts)
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];

    const items: any[] = [];
    for (const id of ids || []) {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try {
        items.push(JSON.parse(raw));
      } catch {
        // якщо збережено plain string — просто скіпаємо або кладемо як є
        items.push({ id, name: String(raw) });
      }
    }

    return NextResponse.json(
      { ok: true, count: items.length, items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// --- POST /api/campaigns (залишаємо як є/мінімальна заглушка) --------------
export async function POST(req: Request) {
  const token = getAdminToken(req);
  if (!isAuthorized(token)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: missing or invalid admin token" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const now = Date.now();
    const id = String(body?.id || now);

    const item = {
      id,
      created_at: now,
      active: !!body?.active,
      name: body?.name || `Campaign ${id}`,
      base_pipeline_id: body?.base_pipeline_id ?? null,
      base_status_id: body?.base_status_id ?? null,
      base_pipeline_name: body?.base_pipeline_name ?? null,
      base_status_name: body?.base_status_name ?? null,
      rules: body?.rules || {},
      exp: body?.exp || undefined,
    };

    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    // Upstash-сов сумісний виклик zadd з об’єктом
    await redis.zadd(INDEX_KEY, { score: now, member: id });

    return NextResponse.json(
      { ok: true, created: id, item },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
