// web/app/(admin)/admin/campaigns/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Opt = { id: string; name: string };
type Pair = { pipeline?: string; status?: string };

export default function NewCampaignPage() {
  // form state
  const [name, setName] = useState("");
  const [v1, setV1] = useState("1");
  const [v2, setV2] = useState("2");

  const [base, setBase] = useState<Pair>({});
  const [t1, setT1] = useState<Pair>({});
  const [t2, setT2] = useState<Pair>({});
  const [texp, setTexp] = useState<Pair>({});

  // dicts
  const [pipes, setPipes] = useState<Opt[]>([]);
  const [stByPipe, setStByPipe] = useState<Record<string, Opt[]>>({});

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ----- fetch pipelines (once)
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/keycrm/pipelines", { cache: "no-store" });
        const data = await res.json();
        if (!cancel) setPipes((data?.data as Opt[]) ?? []);
      } catch {
        if (!cancel) setPipes([]);
      }
    })();
    return () => { cancel = true; };
  }, []);

  // which statuses we need to load now
  const needStatuses = useMemo(() => {
    const ids = [base.pipeline, t1.pipeline, t2.pipeline, texp.pipeline].filter(Boolean) as string[];
    return Array.from(new Set(ids));
  }, [base.pipeline, t1.pipeline, t2.pipeline, texp.pipeline]);

  // fetch statuses per pipeline
  useEffect(() => {
    let cancel = false;
    (async () => {
      for (const pid of needStatuses) {
        if (stByPipe[pid]) continue;
        try {
          const res = await fetch(`/api/keycrm/statuses/${pid}`, { cache: "no-store" });
          const data = await res.json();
          if (!cancel) setStByPipe((prev) => ({ ...prev, [pid]: (data?.data as Opt[]) ?? [] }));
        } catch {
          if (!cancel) setStByPipe((prev) => ({ ...prev, [pid]: [] }));
        }
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needStatuses.join("|")]);

  // compact field render helpers
  const sBase = base.pipeline ? stByPipe[base.pipeline] ?? [] : [];
  const sT1   = t1.pipeline   ? stByPipe[t1.pipeline]   ?? [] : [];
  const sT2   = t2.pipeline   ? stByPipe[t2.pipeline]   ?? [] : [];
  const sExp  = texp.pipeline ? stByPipe[texp.pipeline] ?? [] : [];

  // submit JSON to /api/campaigns
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const payload = {
      name: name.trim(),
      v1: v1 || undefined,
      v2: v2 || undefined,
      base: pairOrUndef(base),
      t1: pairOrUndef(t1),
      t2: pairOrUndef(t2),
      texp: pairOrUndef(texp),
    };

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const isJson = res.headers.get("content-type")?.includes("application/json");
      const data = isJson ? await res.json() : null;

      if (!res.ok) {
        setErr(data?.error || `Помилка створення (${res.status})`);
      } else {
        // back to list
        window.location.href = "/admin/campaigns";
      }
    } catch (e: any) {
      setErr(e?.message || "Мережева помилка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-screen-xl mx-auto">
      <h1 className="text-3xl font-extrabold mb-3">Нова кампанія</h1>

      {/* Компактне полотно в 1 екран: зменшені відступи/висоти та щільні гріди */}
      <form onSubmit={onSubmit} className="space-y-4 text-sm leading-tight">
        {/* БАЗА */}
        <section className="rounded-2xl border p-3">
          <h2 className="font-semibold text-lg mb-2">База</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Назва кампанії">
              <input
                className="w-full border rounded-xl px-3 py-2 h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Назва"
                required
              />
            </Field>
            <Field label="Базова воронка">
              <Select value={base.pipeline ?? ""} onChange={(v) => setBase({ pipeline: v || undefined, status: undefined })}>
                <option value="">—</option>
                {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Базовий статус">
              <Select
                disabled={!base.pipeline}
                value={base.status ?? ""}
                onChange={(v) => setBase((b) => ({ ...b, status: v || undefined }))}
              >
                <option value="">—</option>
                {sBase.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
        </section>

        {/* ВАРІАНТ №1 */}
        <section className="rounded-2xl border p-3">
          <h2 className="font-semibold text-lg mb-2">Варіант №1</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Значення">
              <input
                className="w-full border rounded-xl px-3 py-2 h-9"
                value={v1}
                onChange={(e) => setV1(e.target.value.trim())}
                placeholder="1"
              />
            </Field>
            <Field label="Воронка">
              <Select value={t1.pipeline ?? ""} onChange={(v) => setT1({ pipeline: v || undefined, status: undefined })}>
                <option value="">—</option>
                {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Статус">
              <Select
                disabled={!t1.pipeline}
                value={t1.status ?? ""}
                onChange={(v) => setT1((t) => ({ ...t, status: v || undefined }))}
              >
                <option value="">—</option>
                {sT1.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
        </section>

        {/* ВАРІАНТ №2 */}
        <section className="rounded-2xl border p-3">
          <h2 className="font-semibold text-lg mb-2">Варіант №2</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Значення">
              <input
                className="w-full border rounded-xl px-3 py-2 h-9"
                value={v2}
                onChange={(e) => setV2(e.target.value.trim())}
                placeholder="2"
              />
            </Field>
            <Field label="Воронка">
              <Select value={t2.pipeline ?? ""} onChange={(v) => setT2({ pipeline: v || undefined, status: undefined })}>
                <option value="">—</option>
                {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Статус">
              <Select
                disabled={!t2.pipeline}
                value={t2.status ?? ""}
                onChange={(v) => setT2((t) => ({ ...t, status: v || undefined }))}
              >
                <option value="">—</option>
                {sT2.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
        </section>

        {/* EXPIRE */}
        <section className="rounded-2xl border p-3">
          <h2 className="font-semibold text-lg mb-2">Expire</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Кількість днів до експірації">
              <input className="w-full border rounded-xl px-3 py-2 h-9" value="7" disabled />
            </Field>
            <Field label="Воронка">
              <Select value={texp.pipeline ?? ""} onChange={(v) => setTexp({ pipeline: v || undefined, status: undefined })}>
                <option value="">—</option>
                {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Статус">
              <Select
                disabled={!texp.pipeline}
                value={texp.status ?? ""}
                onChange={(v) => setTexp((t) => ({ ...t, status: v || undefined }))}
              >
                <option value="">—</option>
                {sExp.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
        </section>

        {err && <div className="rounded-md bg-red-50 text-red-700 p-2">{err}</div>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-xl shadow bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Зберегти
          </button>
          <a href="/admin/campaigns" className="px-4 py-2 rounded-xl shadow">Скасувати</a>
        </div>
      </form>
    </div>
  );
}

/* --- small, reusable UI helpers (compact) --- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
function Select({
  value, onChange, disabled, children,
}: { value: string; onChange: (v: string) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <select
      className="w-full border rounded-xl px-3 py-2 h-9 disabled:opacity-60"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {children}
    </select>
  );
}
function pairOrUndef(p: Pair): Pair | undefined {
  if (!p.pipeline && !p.status) return undefined;
  return { pipeline: p.pipeline, status: p.status };
}
