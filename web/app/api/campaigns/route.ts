// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvZRevRange } from "@/lib/kv";
import { kcGetPipelines, kcGetStatuses } from "@/lib/keycrm";

type CampaignKV = {
  id: string;
  name: string;
  active?: boolean;
  created_at?: number | string;

  // базова пара
  base_pipeline_id?: number | string | null;
  base_status_id?: number | string | null;

  // старі плоскі поля (підтримуємо на всяк випадок)
  v1_pipeline_id?: number | string | null;
  v1_status_id?: number | string | null;
  v2_pipeline_id?: number | string | null;
  v2_status_id?: number | string | null;
  exp_days?: number | string | null;
  exp_to_pipeline_id?: number | string | null;
  exp_to_status_id?: number | string | null;

  // нова вкладена схема
  rules?: {
    v1?: {
      field?: "text";
      op?: "contains" | "equals";
      value?: string;
      to_pipeline_id?: number | string | null;
      to_status_id?: number | string | null;
    };
    v2?: {
      field?: "text";
      op?: "contains" | "equals";
      value?: string;
      to_pipeline_id?: number | string | null;
      to_status_id?: number | string | null;
    };
    exp?: {
      days?: number | string | null;
      to_pipeline_id?: number | string | null;
      to_status_id?: number | string | null;
    };
  };

  // лічильники
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function num(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function labelOrDash(name?: string) {
  return name && name.trim() ? name : "—";
}

export async function GET(req: Request) {
  await assertAdmin(req);

  // 1) зчитуємо всі id кампаній у зворотньому порядку (нові зверху)
  const ids = (await kvZRevRange("campaigns:index", 0, -1)) ?? [];

  // 2) забираємо самі кампанії
  const items: CampaignKV[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    items.push(raw as CampaignKV);
  }

  // 3) збираємо УСІ можливі pipeline_id зі всіх сегментів (base, v1, v2, exp)
  const allPipelineIds = new Set<number>();
  for (const c of items) {
    const bp = num(c.base_pipeline_id);
    if (bp) allPipelineIds.add(bp);

    const v1p = num(c.rules?.v1?.to_pipeline_id ?? c.v1_pipeline_id);
    if (v1p) allPipelineIds.add(v1p);

    const v2p = num(c.rules?.v2?.to_pipeline_id ?? c.v2_pipeline_id);
    if (v2p) allPipelineIds.add(v2p);

    const expp = num(c.rules?.exp?.to_pipeline_id ?? c.exp_to_pipeline_id);
    if (expp) allPipelineIds.add(expp);
  }

  // 4) підтягнемо список усіх воронок та побудуємо map
  const pipes = await kcGetPipelines().catch(() => [] as any[]);
  const pipeNameById = new Map<number, string>();
  for (const p of pipes ?? []) {
    const id = num(p?.id);
    const nm = String(p?.name ?? "");
    if (id) pipeNameById.set(id, nm);
  }

  // 5) для кожної потрібної воронки підтягуємо її статуси і теж будуємо map
  const statusNameById = new Map<number, string>();
  for (const pid of allPipelineIds) {
    try {
      const statuses = await kcGetStatuses(pid);
      for (const s of statuses ?? []) {
        const sid = num(s?.id);
        const nm = String(s?.name ?? "");
        if (sid) statusNameById.set(sid, nm);
      }
    } catch {
      // ігноруємо помилки конкретної воронки, просто не буде назв
    }
  }

  // 6) готуємо відповідь у зручному для UI вигляді
  const rows = items.map((c) => {
    const created =
      typeof c.created_at === "number"
        ? new Date(c.created_at)
        : c.created_at
        ? new Date(String(c.created_at))
        : undefined;

    const base_pipeline_id = num(c.base_pipeline_id);
    const base_status_id = num(c.base_status_id);

    const v1_pipeline_id = num(c.rules?.v1?.to_pipeline_id ?? c.v1_pipeline_id);
    const v1_status_id = num(c.rules?.v1?.to_status_id ?? c.v1_status_id);

    const v2_pipeline_id = num(c.rules?.v2?.to_pipeline_id ?? c.v2_pipeline_id);
    const v2_status_id = num(c.rules?.v2?.to_status_id ?? c.v2_status_id);

    const exp_days = num(c.rules?.exp?.days ?? c.exp_days);
    const exp_pipeline_id = num(c.rules?.exp?.to_pipeline_id ?? c.exp_to_pipeline_id);
    const exp_status_id = num(c.rules?.exp?.to_status_id ?? c.exp_to_status_id);

    const base_pipeline_name = base_pipeline_id ? pipeNameById.get(base_pipeline_id) : undefined;
    const base_status_name = base_status_id ? statusNameById.get(base_status_id) : undefined;

    const v1_pipeline_name = v1_pipeline_id ? pipeNameById.get(v1_pipeline_id) : undefined;
    const v1_status_name = v1_status_id ? statusNameById.get(v1_status_id) : undefined;

    const v2_pipeline_name = v2_pipeline_id ? pipeNameById.get(v2_pipeline_id) : undefined;
    const v2_status_name = v2_status_id ? statusNameById.get(v2_status_id) : undefined;

    const exp_pipeline_name = exp_pipeline_id ? pipeNameById.get(exp_pipeline_id) : undefined;
    const exp_status_name = exp_status_id ? statusNameById.get(exp_status_id) : undefined;

    return {
      id: c.id,
      name: c.name,
      active: !!c.active,

      created_at: created?.toISOString() ?? null,
      created_at_human: created
        ? created.toLocaleString("uk-UA", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : null,

      // базова пара
      base: {
        pipeline_id: base_pipeline_id ?? null,
        status_id: base_status_id ?? null,
        pipeline_name: labelOrDash(base_pipeline_name),
        status_name: labelOrDash(base_status_name),
      },

      // V1
      v1: {
        pipeline_id: v1_pipeline_id ?? null,
        status_id: v1_status_id ?? null,
        pipeline_name: labelOrDash(v1_pipeline_name),
        status_name: labelOrDash(v1_status_name),
        count: c.v1_count ?? 0,
        rule: {
          field: c.rules?.v1?.field ?? "text",
          op: c.rules?.v1?.op ?? "contains",
          value: c.rules?.v1?.value ?? "",
        },
      },

      // V2 (може бути порожнім)
      v2: {
        pipeline_id: v2_pipeline_id ?? null,
        status_id: v2_status_id ?? null,
        pipeline_name: labelOrDash(v2_pipeline_name),
        status_name: labelOrDash(v2_status_name),
        count: c.v2_count ?? 0,
        rule: {
          field: c.rules?.v2?.field ?? "text",
          op: c.rules?.v2?.op ?? "contains",
          value: c.rules?.v2?.value ?? "",
        },
      },

      // EXP
      exp: {
        days: exp_days ?? null,
        to_pipeline_id: exp_pipeline_id ?? null,
        to_status_id: exp_status_id ?? null,
        to_pipeline_name: labelOrDash(exp_pipeline_name),
        to_status_name: labelOrDash(exp_status_name),
        count: c.exp_count ?? 0,
      },
    };
  });

  return NextResponse.json({ ok: true, rows });
}
