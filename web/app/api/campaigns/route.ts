// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRevRange } from "@/lib/kv";

// ===== Types =====
type Op = "contains" | "equals";
type Rule = { field: "text"; op: Op; value: string };
type RuleEx = Rule & { pipeline_id: number | null; status_id: number | null };

export type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active: boolean;

  // базова пара (область пошуку та синхронізації)
  base_pipeline_id: number;
  base_status_id: number;

  // правила
  v1: RuleEx;            // обов’язкове, value !== ""
  v2: RuleEx;            // опційне, зберігаємо лише коли value !== ""
  exp: {
    days: number;
    to_pipeline_id: number;
    to_status_id: number;
  };

  // лічильники (можуть бути відсутні в KV)
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

// ===== Helpers =====
const num = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

const ensureRule = (r: Partial<Rule> | null | undefined): Rule => {
  const op: Op = (r?.op === "equals" ? "equals" : "contains");
  const value = (r?.value ?? "").toString().trim();
  return { field: "text", op, value };
};

const buildRuleEx = (
  r: Partial<Rule> | null | undefined,
  pipeline_id?: unknown,
  status_id?: unknown
): RuleEx => {
  const base = ensureRule(r);
  return {
    ...base,
    pipeline_id: num(pipeline_id) || null,
    status_id: num(status_id) || null,
  };
};

const CAMPAIGNS_INDEX = "campaigns:index";
const campaignKey = (id: string) => `campaigns:${id}`;

// ===== GET: список кампаній =====
export async function GET(req: Request) {
  await assertAdmin(req);

  // показуємо останні 1000 (нові зверху)
  const ids: string[] =
    (await kvZRevRange(CAMPAIGNS_INDEX, 0, 999)) ?? [];

  const items: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet(campaignKey(id));
    if (!raw) continue;
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;

    // мʼяка нормалізація, аби UI ніколи не падав
    c.v1 = {
      field: "text",
      op: (c?.v1?.op === "equals" ? "equals" : "contains"),
      value: String(c?.v1?.value ?? ""),
      pipeline_id: c?.v1?.pipeline_id ?? null,
      status_id: c?.v1?.status_id ?? null,
    };
    c.v2 = {
      field: "text",
      op: (c?.v2?.op === "equals" ? "equals" : "contains"),
      value: String(c?.v2?.value ?? ""),
      pipeline_id: c?.v2?.pipeline_id ?? null,
      status_id: c?.v2?.status_id ?? null,
    };

    items.push(c as Campaign);
  }

  return NextResponse.json({ ok: true, count: items.length, items });
}

// ===== POST: створення кампанії =====
/**
 * Очікуваний JSON:
 * {
 *   "name": string,
 *   "base_pipeline_id": number,
 *   "base_status_id": number,
 *   "rules": {
 *     "v1": { "op": "contains"|"equals", "value": string },
 *     "v2": { "op": "contains"|"equals", "value": string }   // опційно
 *   },
 *   "v1_pipeline_id": number | null,  "v1_status_id": number | null, // (необов’язково; можна не задавати)
 *   "v2_pipeline_id": number | null,  "v2_status_id": number | null, // (опційно)
 *   "exp_days": number,
 *   "exp_to_pipeline_id": number,
 *   "exp_to_status_id": number
 * }
 */
export async function POST(req: Request) {
  await assertAdmin(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const name = String(body?.name ?? "").trim();
  const base_pipeline_id = num(body?.base_pipeline_id);
  const base_status_id = num(body?.base_status_id);

  const rV1 = ensureRule(body?.rules?.v1);
  if (!rV1.value) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  // v1 завжди існує; pipeline/status для v1 – не обов’язкові
  const v1: RuleEx = buildRuleEx(body?.rules?.v1, body?.v1_pipeline_id, body?.v1_status_id);

  // v2 — опційне: зберігаємо ТІЛЬКИ якщо value непорожнє
  const v2Candidate = ensureRule(body?.rules?.v2);
  const v2: RuleEx = v2Candidate.value
    ? buildRuleEx(body?.rules?.v2, body?.v2_pipeline_id, body?.v2_status_id)
    : { ...v2Candidate, pipeline_id: null, status_id: null };

  const exp_days = Math.max(0, num(body?.exp_days) || 0);
  const exp_to_pipeline_id = num(body?.exp_to_pipeline_id);
  const exp_to_status_id = num(body?.exp_to_status_id);

  const id = String(Date.now());
  const created_at = Date.now();
  const active = false;

  const campaign: Campaign = {
    id,
    name,
    created_at,
    active,
    base_pipeline_id,
    base_status_id,
    v1,
    v2,
    exp: {
      days: exp_days,
      to_pipeline_id: exp_to_pipeline_id,
      to_status_id: exp_to_status_id,
    },
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  // зберегти
  await kvSet(campaignKey(id), campaign);
  await kvZAdd(CAMPAIGNS_INDEX, created_at, id);

  return NextResponse.json({ ok: true, id, item: campaign }, { status: 201 });
}
