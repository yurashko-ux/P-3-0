// web/app/api/keycrm/sync/diag/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Campaign = {
  id: number | string;
  name?: string;
  active?: boolean;
  base_pipeline_id?: number | string;
  base_status_id?: number | string;
  rules?: unknown;
  deleted?: boolean;
  // інші поля не критичні для діагностики
};

function parseKVJson<T = any>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  if (typeof raw === "object") return raw as T;
  return null;
}

export async function GET(req: Request) {
  await assertAdmin(req);

  // беремо всі campaign-id з індексу
  const ids = (await kvZRange("campaigns:index", 0, -1)) || [];

  const campaigns: Campaign[] = [];
  for (const id of ids) {
    const raw = (await kvGet(`campaigns:${id}`)) as unknown;
    const obj = parseKVJson<Campaign>(raw);
    if (!obj) continue;
    // страховка: якщо в записі нема id — підставляємо з ключа
    if (!("id" in obj) || obj.id == null) obj.id = id;
    campaigns.push(obj);
  }

  // компактна відповідь для швидкої перевірки
  return NextResponse.json({
    ok: true,
    count: campaigns.length,
    ids,
    sample: campaigns[0] ?? null,
    campaigns,
  });
}
