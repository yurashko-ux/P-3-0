// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import {
  kvGet, kvSet, kvZAdd, kvZRevRange, kvDel, kvZRem
} from "@/lib/kv";
import {
  kcGetPipelines,
  kcGetStatusesByPipeline
} from "@/lib/keycrm";

type Rule = { field: "text"; op: "contains" | "equals"; value: string };
type MaybeRule = { pipeline_id?: number | null; status_id?: number | null; value?: string | null };
type ExpCfg = { days: number; to_pipeline_id: number; to_status_id: number };

export type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  v1: MaybeRule;
  v2?: MaybeRule;
  exp: ExpCfg;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function num(n: any): number | null {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}
const safe = <T,>(v: T | undefined | null, d: T) => (v ?? d);

// ---------- GET: list campaigns with resolved names ----------
export async function GET(req: Request) {
  await assertAdmin(req);

  // 1) зчитати всі кампанії (новіші зверху)
  const ids = (await kvZRevRange("campaigns:index", 0, -1)) ?? [];
  const items: Campaign[] = [];
  for (const id of ids) {
    const c = (await kvGet(`campaigns:${id}`)) as Campaign | null;
    if (c) items.push(c);
  }

  // 2) зібрати усі pipeline_id, що зустрічаються
  const pipeIds = new Set<number>();
  for (const c of items) {
    pipeIds.add(Number(c.base_pipeline_id));
    if (num(c.v1?.pipeline_id)) pipeIds.add(Number(c.v1!.pipeline_id));
    if (num(c.v2?.pipeline_id)) pipeIds.add(Number(c.v2!.pipeline_id));
    if (num(c.exp?.to_pipeline_id)) pipeIds.add(Number(c.exp.to_pipeline_id));
  }

  // 3) підтягнути назви воронок і статусів
  const pipelines = (await kcGetPipelines().catch(() => [])) as any[];
  const pipeNameById = new Map<number, string>();
  for (const p of pipelines) {
    const id = Number(p?.id);
    if (id) pipeNameById.set(id, String(p?.name ?? ""));
  }

  const statusNameByPipe = new Map<number, Map<number, string>>();
  for (const pid of pipeIds) {
    const statuses = (await kcGetStatusesByPipeline(pid).catch(() => [])) as any[];
    const map = new Map<number, string>();
    for (const s of statuses) {
      const sid = Number(s?.id);
      if (sid) map.set(sid, String(s?.name ?? ""));
    }
    statusNameByPipe.set(pid, map);
  }

  // 4) побудувати відповідь + resolved labels (додаємо, нічого не ламаємо)
  const withResolved = items.map((c) => {
    const baseP = Number(c.base_pipeline_id);
    const baseS = Number(c.base_status_id);

    const v1P = num(c.v1?.pipeline_id);
    const v1S = num(c.v1?.status_id);

    const v2P = num(c.v2?.pipeline_id);
    const v2S = num(c.v2?.status_id);

    const expP = num(c.exp?.to_pipeline_id);
    const expS = num(c.exp?.to_status_id);

    const res = {
      ...c,
      resolved: {
        base: {
          pipeline: pipeNameById.get(baseP) ?? "",
          status: statusNameByPipe.get(baseP)?.get(baseS) ?? "",
        },
        v1: {
          pipeline: v1P ? (pipeNameById.get(v1P) ?? "") : "",
          status: v1P && v1S ? (statusNameByPipe.get(v1P)?.get(v1S) ?? "") : "",
        },
        v2: {
          pipeline: v2P ? (pipeNameById.get(v2P) ?? "") : "",
          status: v2P && v2S ? (statusNameByPipe.get(v2P)?.get(v2S) ?? "") : "",
        },
        exp: {
          pipeline: expP ? (pipeNameById.get(expP) ?? "") : "",
          status: expP && expS ? (statusNameByPipe.get(expP)?.get(expS) ?? "") : "",
          days: safe(c.exp?.days, 0),
        },
      },
    };
    return res;
  });

  return NextResponse.json({
    ok: true,
    count: withResolved.length,
    items: withResolved,
  });
}

// ---------- POST: create campaign (без змін логіки правил) ----------
export async function POST(req: Request) {
  await assertAdmin(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const now = Date.now();
  const id = String(now);

  const base_pipeline_id = Number(body?.base_pipeline_id);
  const base_status_id = Number(body?.base_status_id);

  if (!base_pipeline_id || !base_status_id) {
    return NextResponse.json(
      { ok: false, error: "base_pipeline_id and base_status_id are required" },
      { status: 400 }
    );
  }

  // V1 обов’язкове значення — лише перевірка value, pipeline/status можуть бути порожніми
  const v1: MaybeRule = {
    pipeline_id: num(body?.v1?.pipeline_id),
    status_id: num(body?.v1?.status_id),
    value: (body?.v1?.value ?? "").trim(),
  };

  if (!v1.value) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  const v2: MaybeRule = {
    pipeline_id: num(body?.v2?.pipeline_id),
    status_id: num(body?.v2?.status_id),
    value: (body?.v2?.value ?? "").trim(),
  };

  const exp: ExpCfg = {
    days: Number(body?.exp?.days ?? 7),
    to_pipeline_id: Number(body?.exp?.to_pipeline_id),
    to_status_id: Number(body?.exp?.to_status_id),
  };

  const campaign: Campaign = {
    id,
    name: String(body?.name ?? "").trim() || "Без назви",
    created_at: now,
    active: Boolean(body?.active ?? false),
    base_pipeline_id,
    base_status_id,
    v1,
    v2,
    exp,
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  await kvSet(`campaigns:${id}`, campaign);
  await kvZAdd("campaigns:index", now, id);

  return NextResponse.json({ ok: true, id, campaign });
}
