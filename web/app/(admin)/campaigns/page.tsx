// web/app/(admin)/campaigns/page.tsx
"use client";

import { useEffect, useState } from "react";

type Names = Record<number, string>;
type Rule = { field: "text"; op: "contains" | "equals"; value: string };
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

  _pipe_name?: Names;
  _status_name?: Names;
};

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/campaigns", { cache: "no-store" });
      const json = await res.json();
      setItems(json?.items ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="p-6 text-slate-500">Завантаження…</div>;
  }
  if (!items.length) {
    return <div className="p-6 text-slate-500">Кампаній поки немає</div>;
  }

  return (
    <div className="p-4 space-y-6">
      {items.map((c) => (
        <div key={c.id} className="rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500 mb-3">
            <div className="font-semibold text-slate-900 text-lg">{c.name}</div>
            <div>{fmtDate(c.created_at)}</div>
            <div className="ml-auto flex gap-4">
              <a className="text-blue-600 hover:underline" href={`/admin/campaigns/${c.id}`}>Edit</a>
              <a className="text-rose-600 hover:underline" href={`/api/campaigns/${c.id}`} onClick={(e) => e.preventDefault()}>Delete</a>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2 items-center">
            {/* BASE */}
            <Cell label="Сутність" value="База" />
            <PipeStatus
              pipeName={name(c._pipe_name, c.base_pipeline_id)}
              statusName={name(c._status_name, c.base_status_id)}
            />
            <Counter label="—" value={null} />
            <StateBadge active={c.active} />

            {/* V1 */}
            <Cell label="Сутність" value="V1" />
            <PipeStatus
              pipeName={name(c._pipe_name, c.v1?.pipeline_id)}
              statusName={name(c._status_name, c.v1?.status_id)}
              empty={!(c.v1?.pipeline_id && c.v1?.status_id)}
            />
            <Counter label="" value={c.v1_count ?? 0} />

            {/* V2 — нове */}
            <Cell label="Сутність" value="V2" />
            <PipeStatus
              pipeName={name(c._pipe_name, c.v2?.pipeline_id)}
              statusName={name(c._status_name, c.v2?.status_id)}
              empty={!(c.v2?.rule?.value)}
            />
            <Counter label="" value={c.v2_count ?? 0} />

            {/* EXP */}
            <Cell label="Сутність" value="EXP" />
            <PipeStatus
              pipeName={name(c._pipe_name, c.exp?.to_pipeline_id)}
              statusName={name(c._status_name, c.exp?.to_status_id)}
              prefix={`${c.exp?.days ?? 7} днів`}
            />
            <Counter label="" value={c.exp_count ?? 0} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="col-span-2 text-sm text-slate-500">{label}</div>
      <div className="col-span-10">
        <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-slate-700">{value}</span>
      </div>
    </>
  );
}

function PipeStatus({
  pipeName,
  statusName,
  empty,
  prefix,
}: {
  pipeName?: string;
  statusName?: string;
  empty?: boolean;
  prefix?: string;
}) {
  if (empty) {
    return (
      <div className="col-span-8 flex items-center gap-2">
        <Pill>—</Pill>
        <Pill>—</Pill>
      </div>
    );
  }
  return (
    <div className="col-span-8 flex items-center gap-2">
      {prefix ? <Pill muted>{prefix}</Pill> : null}
      <Pill>{pipeName ?? "—"}</Pill>
      <Pill>{statusName ?? "—"}</Pill>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="col-span-2 flex items-center justify-end gap-2">
      {label ? <span className="text-sm text-slate-400">{label}</span> : null}
      {value !== null ? <Bubble>{value}</Bubble> : <span className="text-slate-400">—</span>}
    </div>
  );
}

function StateBadge({ active }: { active: boolean }) {
  return (
    <div className="col-span-12 md:col-span-12 lg:col-span-12 text-right text-sm text-slate-500">
      {active ? <span className="text-emerald-600">yes</span> : <span className="text-slate-400">no</span>}
    </div>
  );
}

function Pill({ children, muted }: { children: any; muted?: boolean }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 ${muted ? "bg-slate-100 text-slate-600" : "bg-blue-600/10 text-blue-700"}`}>
      {children}
    </span>
  );
}
function Bubble({ children }: { children: any }) {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700">
      {children}
    </span>
  );
}
function name(map: Record<number, string> | undefined, id?: number | null) {
  if (!id) return undefined;
  return map?.[id] ?? String(id);
}
function fmtDate(ts: number) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return "Invalid Date";
  }
}
