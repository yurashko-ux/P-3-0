// web/app/api/campaigns/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZAdd, kvZRevRange } from "@/lib/kv";

// Динаміка, щоб не кешувалось
export const revalidate = 0;
export const dynamic = "force-dynamic";

// ---- Типи
type VariantOp = "contains" | "equals";
type VariantRule = { field: "text"; op: VariantOp; value: string };
type Campaign = {
  id: number;
  name: string;
  base_pipeline_id: number;
  base_status_id: number;
  rules: { v1: VariantRule; v2?: VariantRule };
  exp_days?: number;
  exp_to_pipeline_id?: number;
  exp_to_status_id?: number;
  active: boolean;
  created_at: number;
  updated_at: number;
  deleted?: boolean;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

// ---- Хелпери
const s = (v: unknown) =>
  (typeof v === "number" ? String(v) : String(v ?? "")).trim();

const pick = <T>(...vals: T[]) =>
  vals.find((v) => v !== undefined && v !== null) as T | undefined;

function coerceRule(raw: any, fallbacks: any, which: "v1" | "v2"): VariantRule | undefined {
  const op =
    (raw?.op ??
      fallbacks?.[`${which}_op`] ??
      fallbacks?.[which]?.op ??
      "contains") as VariantOp;

  const valueRaw =
    pick(
      raw?.value,
      fallbacks?.[`${which}_value`],
      fallbacks?.[which]?.value,
      fallbacks?.[which],
      fallbacks?.[`variant${which === "v1" ? "1" : "2"}Value`],
      fallbacks?.[`variant${which === "v1" ? "1" : "2"}`]?.value
    ) ?? "";

  const value = s(valueRaw);

  if (which === "v1" && !value) {
    throw new Error("rules.v1.value is required (non-empty)");
  }
  if (!value) return undefined;

  return { field: "text", op: (op || "contains") as VariantOp, value };
}

function parseBodyToCampaign(body: any): Campaign {
  const now = Date.now();
  const id =
    Number(pick(body?.id, body?.campaign_id)) || Number(now.toString().slice(-9));

  const name = s(pick(body?.name, body?.title));
  const base_pipeline_id = Number(
    pick(
      body?.base_pipeline_id,
      body?.pipeline_id,
      body?.base?.pipeline_id,
      body?.base_pipeline
    )
  );
  const base_status_id = Number(
    pick(
      body?.base_status_id,
      body?.status_id,
      body?.base?.status_id,
      body?.base_status
    )
  );

  const v1 = coerceRule(body?.rules?.v1, { ...body, v1: body?.v1 }, "v1")!;
  const v2 = coerceRule(body?.rules?.v2, { ...body, v2: body?.v2 }, "v2");

  const exp_days = Number(pick(body?.exp_days, body?.expire_days, body?.expire?.days)) || undefined;
  const exp_to_pipeline_id = Number(
    pick(body?.exp_to_pipeline_id, body?.expire?.to_pipeline_id)
  ) || undefined;
  const exp_to_status_id = Number(
    pick(body?.exp_to_status_id, body?.expire?.to_status_id)
  ) || undefined;

  return {
    id,
    name,
    base_pipeline_id,
    base_status_id,
    rules: v2 ? { v1, v2 } : { v1 },
    exp_days,
    exp_to_pipeline_id,
    exp_to_status_id,
    active: Boolean(pick(body?.active, true)),
    created_at: now,
    updated_at: now,
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };
}

// ---- GET: список кампаній
export async function GET() {
  try {
    // новіші зверху: беремо останні 1000 id у зворотному порядку
    const ids = (await kvZRevRange("campaigns:index", 0, 999)) ?? [];
    const out: Campaign[] = [];
    for (const id of ids) {
      const raw = await kvGet(`campaigns:${id}`);
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!c?.deleted) out.push(c as Campaign);
    }
    // на всяк випадок — ще раз відсортуємо за updated_at
    out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    return NextResponse.json({ ok: true, data: out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "GET failed" },
      { status: 500 }
    );
  }
}

// ---- POST: створити кампанію
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const created = parseBodyToCampaign(body);

    if (!created.name) {
      return NextResponse.json(
        { ok: false, error: "name is required" },
        { status: 400 }
      );
    }
    if (!created.base_pipeline_id || !created.base_status_id) {
      return NextResponse.json(
        { ok: false, error: "base_pipeline_id & base_status_id are required" },
        { status: 400 }
      );
    }

    await kvSet(`campaigns:${created.id}`, created);
    await kvZAdd("campaigns:index", Date.now(), String(created.id));

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message || "POST failed";
    const isBad = msg.includes("rules.v1.value is required");
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isBad ? 400 : 500 }
    );
  }
}
