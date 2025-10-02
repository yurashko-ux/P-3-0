// web/app/(admin)/admin/campaigns/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Opt = { id: string; name: string };
type Pair = { pipeline?: string; status?: string };

export default function NewCampaignPage() {
  // ---- state
  const [name, setName] = useState("");
  const [v1, setV1] = useState<string | undefined>(undefined);
  const [v2, setV2] = useState<string | undefined>(undefined);

  const [base, setBase] = useState<Pair>({});
  const [t1, setT1] = useState<Pair>({});
  const [t2, setT2] = useState<Pair>({});
  const [texp, setTexp] = useState<Pair>({});

  const [pipes, setPipes] = useState<Opt[]>([]);
  const [stByPipe, setStByPipe] = useState<Record<string, Opt[]>>({});

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ---- helpers
  const needStatuses = useMemo(() => {
    const ids = [base.pipeline, t1.pipeline, t2.pipeline, texp.pipeline].filter(Boolean) as string[];
    return Array.from(new Set(ids));
  }, [base.pipeline, t1.pipeline, t2.pipeline, texp.pipeline]);

  // ---- fetch pipelines
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/keycrm/pipelines", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setPipes((data?.data as Opt[]) ?? []);
      } catch (e) {
        if (!cancelled) setPipes([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- fetch statuses for selected pipelines
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const pid of needStatuses) {
        if (stByPipe[pid]) continue;
        try {
          const res = await fetch(`/api/keycrm/statuses/${pid}`, { cache: "no-store" });
          const data = await res.json();
          if (!cancelled) {
            setStByPipe(prev => ({ ...prev, [pid]: (data?.data as Opt[]) ?? [] }));
          }
        } catch {
          if (!cancelled) setStByPipe(prev => ({ ...prev, [pid]: [] }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needStatuses.join("|")]);

  // ---- submit JSON
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const body = {
      name: name.trim(),
      v1, v2,
      base: pairOrUndef(base),
      t1: pairOrUndef(t1),
      t2: pairOrUndef(t2),
      texp: pairOrUndef(texp),
    };

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const isJson = res.headers.get("content-type")?.includes("application/json");
      const data = isJson ? await res.json() : null;

      if (!res.ok) {
        setErr(data?.error || `Помилка створення (${res.status})`);
      } else {
        window.location.href = "/admin/campaigns";
      }
    } catch (e: any) {
      setErr(e?.message || "Мережева помилка");
    } finally {
      setLoading(false);
    }
  }

  // ---- UI helpers
  const sOptsBase = base.pipeline ? stByPipe[base.pipeline] ?? [] : [];
  const sOptsT1   = t1.pipeline   ? stByPipe[t1.pipeline]   ?? [] : [];
  const sOptsT2   = t2.pipeline   ? stByPipe[t2.pipeline]   ?? [] : [];
  const sOptsExp  = texp.pipeline ? stByPipe[texp.pipeline] ?? [] : [];

  return (
    <form onSubmit={onSubmit} className="p-6 space-y-6">
      {/* БАЗА */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">База</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Назва кампанії</label>
            <input className="w-full border rounded-xl px-3 py-2" value={name}
              onChange={e=>setName(e.target.value)} placeholder="Назва" required />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Базова воронка</label>
            <select className="w-full border rounded-xl px-3 py-2"
              value={base.pipeline ?? ""} onChange={e => setBase({ pipeline: nonEmpty(e.target.value), status: undefined })}>
              <option value="">—</option>
              {pipes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Базовий статус</label>
            <select className="w-full border rounded-xl px-3 py-2"
              disabled={!base.pipeline}
              value={base.status ?? ""} onChange={e => setBase(b => ({ ...b, status: nonEmpty(e.target.value) }))}>
              <option value="">—</option>
              {sOptsBase.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* ВАРІАНТ №1 */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Варіант №1</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Значення</label>
            <input className="w-full border rounded-xl px-3 py-2" placeholder="1"
              value={v1 ?? ""} onChange={e => setV1(nonEmpty(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Воронка</label>
            <select className="w-full border rounded-xl px-3 py-2"
              value={t1.pipeline ?? ""} onChange={e => setT1({ pipeline: nonEmpty(e.target.value), status: undefined })}>
              <option value="">—</option>
              {pipes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Статус</label>
            <select className="w-full border rounded-xl px-3 py-2"
              disabled={!t1.pipeline}
              value={t1.status ?? ""} onChange={e => setT1(t => ({ ...t, status: nonEmpty(e.target.value) }))}>
              <option value="">—</option>
              {sOptsT1.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* ВАРІАНТ №2 */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Варіант №2</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Значення</label>
            <input className="w-full border rounded-xl px-3 py-2" placeholder="2"
              value={v2 ?? ""} onChange={e => setV2(nonEmpty(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Воронка</label>
            <select className="w-full border rounded-xl px-3 py-2"
              value={t2.pipeline ?? ""} onChange={e => setT2({ pipeline: nonEmpty(e.target.value), status: undefined })}>
              <option value="">—</option>
              {pipes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Статус</label>
            <select className="w-full border rounded-xl px-3 py-2"
              disabled={!t2.pipeline}
              value={t2.status ?? ""} onChange={e => setT2(t => ({ ...t, status: nonEmpty(e.target.value) }))}>
              <option value="">—</option>
              {sOptsT2.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* EXPIRE */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Expire</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Кількість днів до експірації</label>
            <input className="w-full border rounded-xl px-3 py-2" placeholder="7" disabled />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Воронка</label>
            <select className="w-full border rounded-xl px-3 py-2"
              value={texp.pipeline ?? ""} onChange={e => setTexp({ pipeline: nonEmpty(e.target.value), status: undefined })}>
              <option value="">—</option>
              {pipes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Статус</label>
            <select className="w-full border rounded-xl px-3 py-2"
              disabled={!texp.pipeline}
              value={texp.status ?? ""} onChange={e => setTexp(t => ({ ...t, status: nonEmpty(e.target.value) }))}>
              <option value="">—</option>
              {sOptsExp.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </section>

      {err && <div className="rounded-md bg-red-50 text-red-700 p-3 text-sm">{err}</div>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-xl shadow bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          Зберегти
        </button>
        <a href="/admin/campaigns" className="px-4 py-2 rounded-xl shadow">
          Скасувати
        </a>
      </div>
    </form>
  );
}

function nonEmpty(v: string) { const s = v?.trim(); return s ? s : undefined; }
function pairOrUndef(p: Pair): Pair | undefined {
  if (!p.pipeline && !p.status) return undefined;
  return { pipeline: p.pipeline, status: p.status };
}
