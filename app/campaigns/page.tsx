"use client";

import { useEffect, useMemo, useState } from "react";

type Pipeline = { id: number; title: string };
type Status = { id: number; title: string; pipeline_id: number };

type Campaign = {
  id?: string;
  createdAt?: string | number;
  rule1?: { value: string; to_pipeline_id: number; to_status_id: number; to_pipeline_label?: string; to_status_label?: string; };
  rule2?: { value: string; to_pipeline_id: number; to_status_id: number; to_pipeline_label?: string; to_status_label?: string; };
  expire_days?: number;
  expire_to?: { to_pipeline_id: number; to_status_id: number; to_pipeline_label?: string; to_status_label?: string; };
  // підтримка старого формату
  fromPipelineId?: number | string;
  fromStatusId?: number | string;
  toPipelineId?: number | string;
  toStatusId?: number | string;
  expiresDays?: number | null;
  fromPipelineLabel?: string;
  fromStatusLabel?: string;
  toPipelineLabel?: string;
  toStatusLabel?: string;
};

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
const fmt = (v?: string | number) => {
  if (!v) return "—";
  const d = new Date(typeof v === "string" ? v : Number(v));
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

export default function CampaignsPage() {
  // метадані
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const statusesByPipeline = useMemo(() => {
    const m = new Map<number, Status[]>();
    for (const s of statuses) {
      const arr = m.get(s.pipeline_id) ?? [];
      arr.push(s);
      m.set(s.pipeline_id, arr);
    }
    return m;
  }, [statuses]);

  const pipeLabel = (id: number | "") => (id === "" ? "" : pipelines.find(p => p.id === id)?.title ?? String(id));
  const statusLabel = (pid: number | "", sid: number | "") =>
    pid === "" || sid === "" ? String(sid) : (statusesByPipeline.get(Number(pid))?.find(s => s.id === sid)?.title ?? String(sid));

  // список
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);

  // форма
  const [var1, setVar1] = useState("1");
  const [v1Pipe, setV1Pipe] = useState<number | "">("");
  const [v1Status, setV1Status] = useState<number | "">("");

  const [var2, setVar2] = useState("2");
  const [v2Pipe, setV2Pipe] = useState<number | "">("");
  const [v2Status, setV2Status] = useState<number | "">("");

  const [expDays, setExpDays] = useState("3");
  const [expPipe, setExpPipe] = useState<number | "">("");
  const [expStatus, setExpStatus] = useState<number | "">("");

  useEffect(() => {
    (async () => {
      try {
        const [pl, st, list] = await Promise.all([
          j<any>("/api/keycrm/pipelines").catch(() => ({ data: [] })),
          j<any>("/api/keycrm/statuses").catch(() => ({ data: [] })),
          j<any>("/api/campaigns"),
        ]);

        const pp: Pipeline[] = (pl?.data || pl?.items || []).map((p: any) => ({
          id: Number(p.id ?? p.pipeline_id ?? p.value ?? p?.pipeline?.id),
          title: String(p.title ?? p.name ?? p.label ?? p?.pipeline?.title),
        }));
        const ss: Status[] = (st?.data || st?.items || []).map((s: any) => ({
          id: Number(s.id),
          title: String(s.title ?? s.name ?? s.label),
          pipeline_id: Number(s.pipeline_id ?? s.pipeline?.id),
        }));

        setPipelines(pp.filter(p => Number.isFinite(p.id)));
        setStatuses(ss.filter(s => Number.isFinite(s.id) && Number.isFinite(s.pipeline_id)));
        setItems(Array.isArray(list?.items) ? list.items : []);
      } finally { setLoading(false); }
    })();
  }, []);

  function buildPayload(): Campaign {
    return {
      rule1: v1Pipe && v1Status ? {
        value: var1.trim(),
        to_pipeline_id: Number(v1Pipe),
        to_status_id: Number(v1Status),
        to_pipeline_label: pipeLabel(v1Pipe),
        to_status_label: statusLabel(v1Pipe, v1Status),
      } : undefined,
      rule2: v2Pipe && v2Status ? {
        value: var2.trim(),
        to_pipeline_id: Number(v2Pipe),
        to_status_id: Number(v2Status),
        to_pipeline_label: pipeLabel(v2Pipe),
        to_status_label: statusLabel(v2Pipe, v2Status),
      } : undefined,
      expire_days: Number(expDays) || undefined,
      expire_to: expPipe && expStatus ? {
        to_pipeline_id: Number(expPipe),
        to_status_id: Number(expStatus),
        to_pipeline_label: pipeLabel(expPipe),
        to_status_label: statusLabel(expPipe, expStatus),
      } : undefined,

      // сумісність зі старим форматом
      toPipelineId: v1Pipe || v2Pipe || expPipe || "",
      toStatusId: v1Status || v2Status || expStatus || "",
      expiresDays: Number(expDays) || null,
      toPipelineLabel: pipeLabel((v1Pipe || v2Pipe || expPipe || "") as number | ""),
      toStatusLabel: statusLabel((v1Pipe || v2Pipe || expPipe || "") as number | "", (v1Status || v2Status || expStatus || "") as number | ""),
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await j("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const list = await j<any>("/api/campaigns");
      setItems(Array.isArray(list?.items) ? list.items : []);
      setFlash(true); setTimeout(() => setFlash(false), 1500);
    } finally { setSaving(false); }
  }

  async function removeCampaign(id?: string) {
    if (!id) return;
    if (!confirm("Видалити кампанію?")) return;
    await j(`/api/campaigns/${id}`, { method: "DELETE" }).catch(() => {});
    const list = await j<any>("/api/campaigns");
    setItems(Array.isArray(list?.items) ? list.items : []);
  }

  const renderCond = (c: Campaign) => {
    if (c.rule1 || c.rule2 || c.expire_to || c.expire_days != null) {
      const p: string[] = [];
      if (c.rule1) p.push(`${c.rule1.value} → ${c.rule1.to_pipeline_label ?? c.rule1.to_pipeline_id} / ${c.rule1.to_status_label ?? c.rule1.to_status_id}`);
      if (c.rule2) p.push(`${c.rule2.value} → ${c.rule2.to_pipeline_label ?? c.rule2.to_pipeline_id} / ${c.rule2.to_status_label ?? c.rule2.to_status_id}`);
      if (c.expire_days != null || c.expire_to)
        p.push(`${c.expire_days ?? "—"}d → ${c.expire_to?.to_pipeline_label ?? c.expire_to?.to_pipeline_id ?? "—"} / ${c.expire_to?.to_status_label ?? c.expire_to?.to_status_id ?? "—"}`);
      return p.join("; ");
    }
    if (c.toPipelineId || c.toStatusId || c.fromPipelineId || c.fromStatusId) {
      const fromPipe = c.fromPipelineLabel ?? c.fromPipelineId ?? "—";
      const fromStat = c.fromStatusLabel ?? c.fromStatusId ?? "—";
      const toPipe   = c.toPipelineLabel ?? c.toPipelineId ?? "—";
      const toStat   = c.toStatusLabel ?? c.toStatusId ?? "—";
      return `${fromPipe} / ${fromStat} → ${toPipe} / ${toStat}`;
    }
    return "—";
  };

  const expiresCol = (c: Campaign) =>
    c.expire_days != null ? `${c.expire_days}d` : c.expiresDays != null ? `${c.expiresDays}d` : "—";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-5xl font-extrabold tracking-tight mb-6">Campaigns Admin</h1>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-6">
        <div className="flex gap-3 items-center">
          <button type="button" className="rounded-xl border px-4 py-2 bg-slate-900 text-white">Кампанії</button>
          {flash && <span className="text-emerald-600 font-medium">Збережено ✅</span>}
        </div>
      </div>

      <div className="rounded-2xl border-2 border-rose-300 bg-white p-5 mb-8">
        <h2 className="text-xl font-extrabold mb-4">Змінні пишемо прямо в рядках зі своїми воронками/статусами.</h2>

        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Рядок 1 */}
          <div>
            <div className="text-sm text-slate-500 mb-1">Змінна №1 (значення з Manychat)</div>
            <input value={var1} onChange={(e)=>setVar1(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
          </div>
          <div>
            <div className="text-sm text-slate-500 mb-1">Воронка №1</div>
            <select value={v1Pipe} onChange={(e)=>{const v=e.target.value?Number(e.target.value):""; setV1Pipe(v); setV1Status("");}} className="w-full rounded-xl border px-3 py-2">
              <option value="">—</option>
              {pipelines.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <div className="text-sm text-slate-500 mb-1">Статус</div>
            <select value={v1Status} onChange={(e)=>setV1Status(e.target.value?Number(e.target.value):"")} className="w-full rounded-xl border px-3 py-2">
              <option value="">—</option>
              {Number.isFinite(v1Pipe) && (statusesByPipeline.get(Number(v1Pipe))||[]).map(s=><option key={`1-${s.id}`} value={s.id}>{s.title}</option>)}
            </select>
          </div>

          {/* Рядок 2 */}
          <div>
            <div className="text-sm text-slate-500 mb-1">Змінна №2 (значення з Manychat)</div>
            <input value={var2} onChange={(e)=>setVar2(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
          </div>
          <div>
            <div className="text-sm text-slate-500 mb-1">Воронка №2</div>
            <select value={v2Pipe} onChange={(e)=>{const v=e.target.value?Number(e.target.value):""; setV2Pipe(v); setV2Status("");}} className="w-full rounded-xl border px-3 py-2">
              <option value="">—</option>
              {pipelines.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <div className="text-sm text-slate-500 mb-1">Статус</div>
            <select value={v2Status} onChange={(e)=>setV2Status(e.target.value?Number(e.target.value):"")} className="w-full rounded-xl border px-3 py-2">
              <option value="">—</option>
              {Number.isFinite(v2Pipe) && (statusesByPipeline.get(Number(v2Pipe))||[]).map(s=><option key={`2-${s.id}`} value={s.id}>{s.title}</option>)}
            </select>
          </div>

          {/* Рядок 3 — expire */}
          <div>
            <div className="text-sm text-slate-500 mb-1">Змінна №3 — Expires (days)</div>
            <input value={expDays} onChange={(e)=>setExpDays(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
          </div>
          <div>
            <div className="text-sm text-slate-500 mb-1">Воронка (немає відповіді)</div>
            <select value={expPipe} onChange={(e)=>{const v=e.target.value?Number(e.target.value):""; setExpPipe(v); setExpStatus("");}} className="w-full rounded-xl border px-3 py-2">
              <option value="">—</option>
              {pipelines.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <div className="text-sm text-slate-500 mb-1">Статус</div>
            <select value={expStatus} onChange={(e)=>setExpStatus(e.target.value?Number(e.target.value):"")} className="w-full rounded-xl border px-3 py-2">
              <option value="">—</option>
              {Number.isFinite(expPipe) && (statusesByPipeline.get(Number(expPipe))||[]).map(s=><option key={`e-${s.id}`} value={s.id}>{s.title}</option>)}
            </select>
          </div>

          <div className="md:col-span-3">
            <button type="submit" disabled={saving} className="rounded-xl px-4 py-2 bg-black text-white disabled:opacity-50">
              {saving ? "Зберігаю…" : "Зберегти кампанію"}
            </button>
          </div>
        </form>
      </div>

      {/* список */}
      <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
        <div className="grid grid-cols-12 px-6 py-3 text-slate-600 text-sm font-semibold bg-slate-50">
          <div className="col-span-3">Створено</div>
          <div className="col-span-5">Умови (з → в)</div>
          <div className="col-span-2">Expires</div>
          <div className="col-span-2 text-right">Дії</div>
        </div>
        {loading ? (
          <div className="p-6 text-slate-500">Завантаження…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-slate-500">Немає збережених кампаній</div>
        ) : (
          items.map((c, i) => (
            <div key={c.id ?? i} className="grid grid-cols-12 items-center px-6 py-4 border-t">
              <div className="col-span-3">{fmt(c.createdAt)}</div>
              <div className="col-span-5"><div className="font-medium">{renderCond(c)}</div></div>
              <div className="col-span-2">{expiresCol(c)}</div>
              <div className="col-span-2 text-right">
                {c.id && <button onClick={()=>removeCampaign(c.id!)} className="text-red-600 underline">Видалити</button>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function renderCond(c: Campaign) {
  if (c.rule1 || c.rule2 || c.expire_to || c.expire_days != null) {
    const p: string[] = [];
    if (c.rule1) p.push(`${c.rule1.value} → ${c.rule1.to_pipeline_label ?? c.rule1.to_pipeline_id} / ${c.rule1.to_status_label ?? c.rule1.to_status_id}`);
    if (c.rule2) p.push(`${c.rule2.value} → ${c.rule2.to_pipeline_label ?? c.rule2.to_pipeline_id} / ${c.rule2.to_status_label ?? c.rule2.to_status_id}`);
    if (c.expire_days != null || c.expire_to)
      p.push(`${c.expire_days ?? "—"}d → ${c.expire_to?.to_pipeline_label ?? c.expire_to?.to_pipeline_id ?? "—"} / ${c.expire_to?.to_status_label ?? c.expire_to?.to_status_id ?? "—"}`);
    return p.join("; ");
  }
  if (c.toPipelineId || c.toStatusId || c.fromPipelineId || c.fromStatusId) {
    const fromPipe = c.fromPipelineLabel ?? c.fromPipelineId ?? "—";
    const fromStat = c.fromStatusLabel ?? c.fromStatusId ?? "—";
    const toPipe   = c.toPipelineLabel ?? c.toPipelineId ?? "—";
    const toStat   = c.toStatusLabel ?? c.toStatusId ?? "—";
    return `${fromPipe} / ${fromStat} → ${toPipe} / ${toStat}`;
  }
  return "—";
}
function expiresCol(c: Campaign) {
  return c.expire_days != null ? `${c.expire_days}d` : c.expiresDays != null ? `${c.expiresDays}d` : "—";
}
