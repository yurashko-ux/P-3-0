// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvZRevRange } from "@/lib/kv";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type Campaign = {
  id: string;
  name: string;
  active?: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  rules: {
    v1: { field: "text"; op: "contains" | "equals"; value: string };
    v2?: { field: "text"; op: "contains" | "equals"; value: string };
  };
  // лічильники / технічні поля можуть бути, але для списку не обов'язкові
};

function safeJSON<T>(raw: unknown): T | null {
  if (raw == null) return null;
  try {
    if (typeof raw === "string") return JSON.parse(raw) as T;
    return raw as T;
  } catch {
    return null;
  }
}

// GET /api/campaigns — віддає нові зверху
export async function GET(req: Request) {
  await assertAdmin(req);

  // беремо всі id з індексу у зворотному порядку (нові зверху)
  let ids: string[] = [];
  try {
    const z = await kvZRevRange("campaigns:index", 0, -1);
    ids = Array.isArray(z) ? z.map(String) : [];
  } catch {
    ids = [];
  }

  const items: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    const c = safeJSON<Campaign>(raw);
    if (!c) continue;
    // підстрахуємо id, якщо не збережений у тілі
    (c as any).id = c.id ?? id;
    items.push(c);
  }

  return NextResponse.json({ ok: true, data: items });
}
