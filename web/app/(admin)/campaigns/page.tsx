// web/app/(admin)/campaigns/page.tsx
"use client";

import useSWR from "swr";
import { useMemo } from "react";

type Op = "contains" | "equals";
type RuleEx = { field: "text"; op: Op; value: string; pipeline_id: number | null; status_id: number | null };
type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  v1: RuleEx;
  v2: RuleEx; // NEW: показуємо другу умову, якщо задано value
  exp: { days: number; to_pipeline_id: number; to_status_id: number };
  v1_count?: number;
  v2_count?: number; // NEW: лічильник для V2 якщо є
  exp_count?: number;
};

const fetcher = (url: string) => fetch(url, { credentials: "include" }).then((r) => r.json());

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-blue-600/10 text-blue-700 px-3 py-1 text-sm font-medium">
      {children}
    </span>
  );
}

function Dash() {
  return <span className="text-2xl leading-none text-slate-400">—</span>;
}

export default function CampaignsPage() {
  const { data, isLoading } = useSWR("/api/campaigns", fetcher, { refreshInterval: 0 });

  const items: Campaign[] = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <h1 className="text-3xl font-bold mb-6">Кампанії</h1>

      {!isLoading && items.length === 0 && (
        <div className="rounded-2xl border border-slate-200 p-14 text-center text-slate-500">
          Кампаній поки немає
        </div>
      )}

      <div className="space-y-6">
        {items.map((c) => (
          <div key={c.id} className="rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <div className="text-slate-500">
                {new Date(c.created_at).toLocaleString()}
              </div>
              <div className="space-x-3">
                {/* Посилання Edit/Delete залишають як є у вашому проєкті */}
                <a className="text-blue-600 hover:underline" href={`/admin/campaigns/${c.id}/edit`}>Edit</a>
                <a className="text-rose-600 hover:underline" href={`/admin/campaigns/${c.id}/delete`}>Delete</a>
              </div>
            </div>

            <div className="mt-2 mb-4 text-xl font-semibold">{c.name}</div>

            <div className="grid grid-cols-12 gap-y-2 gap-x-3 text-sm items-center">
              {/* БАЗА */}
              <div className="col-span-2 text-slate-500">База</div>
              <div className="col-span-5">
                <div className="flex items-center gap-2">
                  <Badge>Воронка #{c.base_pipeline_id}</Badge>
                  <Badge>Статус #{c.base_status_id}</Badge>
                </div>
              </div>
              <div className="col-span-2 text-slate-500">Тригер</div>
              <div className="col-span-3"><Dash /></div>

              {/* V1 */}
              <div className="col-span-2 text-slate-500">V1</div>
              <div className="col-span-5">
                <div className="flex items-center gap-2">
                  {c.v1.value ? (
                    <>
                      <Badge>{c.v1.op === "equals" ? "Дорівнює" : "Містить"}</Badge>
                      <Badge>{c.v1.value}</Badge>
                    </>
                  ) : (
                    <Dash />
                  )}
                </div>
              </div>
              <div className="col-span-2 text-slate-500">Лічильник</div>
              <div className="col-span-3">
                <Badge>{c.v1_count ?? 0}</Badge>
              </div>

              {/* V2 — NEW */}
              <div className="col-span-2 text-slate-500">V2</div>
              <div className="col-span-5">
                <div className="flex items-center gap-2">
                  {c.v2?.value ? (
                    <>
                      <Badge>{c.v2.op === "equals" ? "Дорівнює" : "Містить"}</Badge>
                      <Badge>{c.v2.value}</Badge>
                      {c.v2.pipeline_id ? <Badge>Воронка #{c.v2.pipeline_id}</Badge> : null}
                      {c.v2.status_id ? <Badge>Статус #{c.v2.status_id}</Badge> : null}
                    </>
                  ) : (
                    <Dash />
                  )}
                </div>
              </div>
              <div className="col-span-2 text-slate-500">Лічильник</div>
              <div className="col-span-3">
                <Badge>{c.v2?.value ? (c.v2_count ?? 0) : 0}</Badge>
              </div>

              {/* EXP */}
              <div className="col-span-2 text-slate-500">EXP</div>
              <div className="col-span-5">
                <div className="flex items-center gap-2">
                  <Badge>Через {c.exp.days} днів</Badge>
                  <Badge>→ Воронка #{c.exp.to_pipeline_id}</Badge>
                  <Badge>→ Статус #{c.exp.to_status_id}</Badge>
                </div>
              </div>
              <div className="col-span-2 text-slate-500">Лічильник</div>
              <div className="col-span-3">
                <Badge>{c.exp_count ?? 0}</Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
