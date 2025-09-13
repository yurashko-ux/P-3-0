// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRange } from "@/lib/kv";

type VariantRule = {
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
  rules: { v1: VariantRule; v2?: VariantRule };
  exp?: { days?: number; to_pipeline_id?: number; to_status_id?: number };
  counters?: { v1_count?: number; v2_count?: number; exp_count?: number };
  active?: boolean;
  deleted?: boolean;
  created_at?: string;
  updated_at?: string;
};

// ✅ Публічний GET: повертає всі НЕ видалені кампанії
export async function GET() {
  try {
    // читаємо індекс (за зростанням score), далі відсортуємо по updated_at desc
    const ids = (await kvZRange("campaigns:index", 0, -1)) || [];
    const out: Campaign[] = [];

    for (const id of ids) {
      const row = await kvGet(`campaigns:${id}`);
      if (!row) continue;
      const obj: Campaign = typeof row === "string" ? JSON.parse(row) : row;
      if (obj?.deleted) continue; // приховуємо видалені
      out.push(obj);
    }

    // найновіші першими
    out.sort((a, b) => {
      const au = new Date(a.updated_at || a.created_at || 0).getTime();
      const bu = new Date(b.updated_at || b.created_at || 0).getTime();
      return bu - au;
    });

    return NextResponse.json({ ok: true, data: out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500 }
    );
  }
}
