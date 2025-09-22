// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis } from '../../../lib/redis';

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string | number) => `campaigns:${id}`;

function isAdmin(): boolean {
  const c = cookies();
  const cookieToken =
    c.get('admin_token')?.value ||
    c.get('admin_pass')?.value ||
    c.get('ADMIN_TOKEN')?.value ||
    c.get('ADMIN_PASS')?.value ||
    '';

  const envToken =
    process.env.ADMIN_TOKEN ||
    process.env.ADMIN_PASS ||
    '';

  // Якщо в env задано токен — вимагаємо збіг. Якщо ні — пропускаємо (dev).
  if (envToken) {
    return cookieToken && cookieToken === envToken;
  }
  return true;
}

export const dynamic = 'force-dynamic';

// GET /api/campaigns — список кампаній (desc)
export async function GET() {
  try {
    if (!isAdmin()) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: missing or invalid admin token' },
        { status: 401 },
      );
    }

    // id з індексу (найсвіжіші спочатку)
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];

    const items: any[] = [];
    for (const id of ids || []) {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        // Підстрахуємося полями для таблиці
        items.push({
          id,
          name: obj?.name ?? '',
          created_at: obj?.created_at ?? Date.now(),
          base_pipeline_id: obj?.base_pipeline_id ?? obj?.pipeline_id ?? null,
          base_status_id: obj?.base_status_id ?? obj?.status_id ?? null,
          rules: obj?.rules ?? {},
          exp: obj?.exp ?? {},
          v1_count: obj?.v1_count ?? 0,
          v2_count: obj?.v2_count ?? 0,
          exp_count: obj?.exp_count ?? 0,
          active: obj?.active ?? true,
        });
      } catch {
        // якщо це не JSON — пропускаємо
      }
    }

    return NextResponse.json(
      {
        ok: true,
        count: items.length,
        items,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500 },
    );
  }
}
