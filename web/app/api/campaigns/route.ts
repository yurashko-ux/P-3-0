// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZRevRange, kvZAdd } from "@/lib/kv";
import { assertAdmin } from "@/lib/auth";

type Op = "contains" | "equals";
type Rule = { field: "text"; op: Op; value: string };
type Variant = { pipeline_id: number | null; status_id: number | null; rule?: Rule };
type Expire = { days: number; to_pipeline_id: number | null; to_status_id: number | null };

type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active: boolean;

  base_pipeline_id: number;
  base_status_id: number;

  v1: Variant;
  v2: Variant;

  exp: Expire;

  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  // — збагачені (для списку)
  _pipe_name?: Record<number, string>;
  _status_name?: Record<number, string>;
};

const KC_BASE = process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1";
const KC_TOKEN = process.env.KEYCRM_API_TOKEN || "";

async function kcFetch(path: string) {
  const res = await fetch(`${KC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${KC_TOKEN}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KeyCRM ${path} failed: ${res.status}`);
  return res.json();
}

async function loadPipeAndStatusNames(pipelineIds: number[]) {
  const pipeNameById = new Map<number, string>();
  const statusNameById = new Map<number, string>();

  // 1) усі воронки
  const pipes = await kcFetch(`/pipelines`).catch(() => ({ data: [] as any[] }));
  const list = Array.isArray(pipes?.data) ? pipes.data : pipes;
  for (const p of list ?? []) {
    const id = Number(p?.id);
    const nm = String(p?.name ?? "");
    if (id) pipeNameById.set(id, nm);
  }

  // 2) статуси тільки для тих воронок, що реально зустрілись
  const uniq = [...new Set(pipelineIds.filter(Boolean))];
  for (const pid of uniq) {
    const statuses = await kcFetch(`/pipelines/${pid}/statuses`).catch(() => ({ data: [] as any[] }));
    const arr = Array.isArray(statuses?.data) ? statuses.data : statuses;
    for (const s of arr ?? []) {
      const sid = Number(s?.id);
      const nm = String(s?.name ?? "");
      if (sid) statusNameById.set(sid, nm);
    }
  }

  return { pipeNameById, statusNameById };
}

/** GET /api/campaigns — зі збагаченими назвами воронок/статусів і V2 */
export async function GET(req: Request) {
  await assertAdmin(req);

  // останні 1000 id, новіші зверху
  const ids: string[] = (await kvZRevRange("campaigns:index", 0, 999)) ?? [];
  const items: Campaign[] = [];
  const pipelineIds: number[] = [];

  for (const id of ids) {
    const raw = await kvGet<Campaign>(`campaigns:${id}`);
    if (!raw) continue;
    items.push(raw);

    // зібрати всі pipeline_id які трапляються (щоб потім підтягнути назви статусів для них)
    pipelineIds.push(
      raw.base_pipeline_id,
      raw.v1?.pipeline_id ?? 0,
      raw.v2?.pipeline_id ?? 0,
      raw.exp?.to_pipeline_id ?? 0
    );
  }

  // карта імен
  const { pipeNameById, statusNameById } = await loadPipeAndStatusNames(pipelineIds);

  // прикріпити на кожен елемент (щоб UI міг напряму показувати назви)
  for (const c of items) {
    c._pipe_name = Object.fromEntries(pipeNameById);
    c._status_name = Object.fromEntries(statusNameById);
  }

  return NextResponse.json({ ok: true, count: items.length, items });
}

/** POST /api/campaigns — створення з підтримкою V2 */
export async function POST(req: Request) {
  await assertAdmin(req);

  const body = await req.json().catch(() => ({} as any));

  // Дістаємо дані з різних можливих форм (щоб бути сумісними з поточним UI)
  const name = String(body?.name ?? "").trim();
  const base_pipeline_id = Number(body?.base_pipeline_id ?? body?.base?.pipeline_id);
  const base_status_id = Number(body?.base_status_id ?? body?.base?.status_id);

  // ------ V1
  const v1_pipe = num(body?.v1?.pipeline_id ?? body?.variants?.v1?.pipeline_id);
  const v1_stat = num(body?.v1?.status_id ?? body?.variants?.v1?.status_id);
  const v1_val = String(body?.rules?.v1?.value ?? body?.v1?.value ?? "").trim();
  const v1_op: Op = normOp(body?.rules?.v1?.op ?? body?.v1?.op ?? "contains");

  if (!name) return bad(400, "name is required");
  if (!base_pipeline_id || !base_status_id) return bad(400, "base pipeline/status is required");
  if (!v1_val) return bad(400, "rules.v1.value is required (non-empty)");

  // ------ V2 (опційно)
  const v2_pipe = num(body?.v2?.pipeline_id ?? body?.variants?.v2?.pipeline_id);
  const v2_stat = num(body?.v2?.status_id ?? body?.variants?.v2?.status_id);
  const v2_val_raw = String(body?.rules?.v2?.value ?? body?.v2?.value ?? "").trim();
  const v2_has = v2_val_raw.length > 0;
  const v2_op: Op = normOp(body?.rules?.v2?.op ?? body?.v2?.op ?? "contains");

  // ------ EXP
  const exp_days = Number(body?.exp?.days ?? body?.expire?.days ?? 7);
  const exp_to_pipeline_id = num(body?.exp?.to_pipeline_id ?? body?.expire?.pipeline_id);
  const exp_to_status_id = num(body?.exp?.to_status_id ?? body?.expire?.status_id);

  const id = String(Date.now());
  const campaign: Campaign = {
    id,
    name,
    created_at: Date.now(),
    active: false,

    base_pipeline_id,
    base_status_id,

    v1: {
      pipeline_id: v1_pipe,
      status_id: v1_stat,
      rule: { field: "text", op: v1_op, value: v1_val },
    },
    v2: v2_has
      ? {
          pipeline_id: v2_pipe,
          status_id: v2_stat,
          rule: { field: "text", op: v2_op, value: v2_val_raw },
        }
      : { pipeline_id: null, status_id: null, rule: { field: "text", op: "contains", value: "" } },

    exp: {
      days: Number.isFinite(exp_days) && exp_days > 0 ? exp_days : 7,
      to_pipeline_id: exp_to_pipeline_id,
      to_status_id: exp_to_status_id,
    },

    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  await kvSet(`campaigns:${id}`, campaign);
  await kvZAdd("campaigns:index", Date.now(), id);

  return NextResponse.json({ ok: true, saved: campaign }, { status: 201 });
}

// helpers
function bad(status = 400, message = "bad request") {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function num(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function normOp(v: any): Op {
  return v === "equals" ? "equals" : "contains";
}
