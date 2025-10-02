// web/app/(admin)/admin/campaigns/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Opt = { id: string; name: string };
type Pair = { pipeline?: string; status?: string };

export default function NewCampaignPage() {
  // ---- form
  const [name, setName] = useState("");
  const [v1, setV1] = useState("1");
  const [v2, setV2] = useState("2");

  const [base, setBase] = useState<Pair>({});
  const [t1, setT1] = useState<Pair>({});
  const [t2, setT2] = useState<Pair>({});
  const [texp, setTexp] = useState<Pair>({});

  // ---- dicts
  const [pipes, setPipes] = useState<Opt[]>([]);
  const [stByPipe, setStByPipe] = useState<Record<string, Opt[]>>({});
  const [dictLoading, setDictLoading] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);

  // fetch pipelines
  async function loadPipelines() {
    setDictLoading(true);
    setDictError(null);
    try {
      const res = await fetch("/api/keycrm/pipelines", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setPipes(Array.isArray(data.data) ? data.data : []);
    } catch (e: any) {
      setPipes([]);
      setDictError("Не вдалося завантажити воронки");
      console.warn("pipelines load failed:", e?.message || e);
    } finally {
      setDictLoading(false);
    }
  }
  useEffect(() => { loadPipelines(); }, []);

  // which pipelines need statuses
  const needStatuses = useMemo(() => {
    const ids = [base.pipeline, t1.pipeline, t2.pipeline, texp.pipeline].filter(Boolean) as string[];
    return Array.from(new Set(ids));
  }, [base.pipeline, t1.pipeline, t2.pipeline, texp.pipeline]);

  // fetch statuses per pipeline
  useEffect(() => {
    let canceled = false;
    (async () => {
      for (const pid of needStatuses) {
        if (stByPipe[pid]) continue;
        try {
          const res = await fetch(`/api/keycrm/statuses/${pid}`, { cache: "no-store" });
          const data = await res.json();
          const list = Array.isArray(data?.data) ? data.data as Opt[] : [];
          if (!canceled) setStByPipe(prev => ({ ...prev, [pid]: list }));
        } catch (e) {
          if (!canceled) setStByPipe(prev => ({ ...prev, [pid]: [] }));
        }
      }
    })();
    return () => { canceled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needStatuses.join("|")]);

  // helpers
  const sBase = base.pipeline ? stByPipe[base.pipeline] ?? [] : [];
  const sT1   = t1.pipeline   ? stByPipe[t1.pipeline]   ?? [] : [];
  const sT2   = t2.pipeline   ? stByPipe[t2.pipeline]   ?? [] : [];
  const sExp  = texp.pipeline ? stByPipe[texp.pipeline] ?? [] : [];

  // submit JSON
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitErr(null);
    setSubmitting(true);

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
        setSubmitErr(data?.error || `Помилка створення (${res.status})`);
      } else {
        window.location.href = "/admin/campaigns";
      }
    } catch (e: any) {
      setSubmitErr(e?.message || "Мережева помилка");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-extrabold mb-3">Нова кампанія</h1>

      <form onSubmit={onSubmit} className="space-y-4 text-sm leading-tight">
        {/* БАЗА */}
        <Card title="База">
          <Grid3>
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
              <Select
                value={base.pipeline ?? ""}
                onChange={(v) => setBase({ pipeline: v || undefined, status: undefined })}
                options={pipes}
                loading={dictLoading}
              />
            </Field>
            <Field label="Базовий статус">
              <Select
                value={base.status ?? ""}
                onChange={(v) => setBase((b) => ({ ...b, status: v || undefined }))}
                options={sBase}
                disabled={!base.pipeline}
                loading={dictLoading && !!base.pipeline}
              />
            </Field>
          </Grid3>
        </Card>

        {/* ВАРІАНТ №1 */}
        <Card title="Варіант №1">
          <Grid3>
            <Field label="Значення">
              <input
                className="w-full border rounded-xl px-3 py-2 h-9"
                value={v1}
                onChange={(e) => setV1(e.target.value)}
                placeholder="1"
              />
            </Field>
            <Field label="Воронка">
              <Select
                value={t1.pipeline ?? ""}
                onChange={(v) => setT1({ pipeline: v || undefined, status: undefined })}
                options={pipes}
                loading={dictLoading}
              />
            </Field>
            <Field label="Статус">
              <Select
                value={t1.status ?? ""}
                onChange={(v) => setT1((t) => ({ ...t, status: v || undefined }))}
                options={sT1}
                disabled={!t1.pipeline}
                loading={dictLoading && !!t1.pipeline}
              />
            </Field>
          </Grid3>
        </Card>

        {/* ВАРІАНТ №2 */}
        <Card title="Варіант №2">
          <Grid3>
            <Field label="Значення">
              <input
                className="w-full border rounded-xl px-3 py-2 h-9"
                value={v2}
                onChange={(e) => setV2(e.target.value)}
                placeholder="2"
              />
            </Field>
            <Field label="Воронка">
              <Select
                value={t2.pipeline ?? ""}
                onChange={(v) => setT2({ pipeline: v || undefined, status: undefined })}
                options={pipes}
                loading={dictLoading}
              />
            </Field>
            <Field label="Статус">
              <Select
                value={t2.status ?? ""}
                onChange={(v) => setT2((t) => ({ ...t, status: v || undefined }))}
                options={sT2}
                disabled={!t2.pipeline}
                loading={dictLoading && !!t2.pipeline}
              />
            </Field>
          </Grid3>
        </Card>

        {/* EXPIRE */}
        <Card title="Expire">
          <Grid3>
            <Field label="Кількість днів до експірації">
              <input className="w-full border rounded-xl px-3 py-2 h-9" value="7" disabled />
            </Field>
            <Field label="Воронка">
              <Select
                value={texp.pipeline ?? ""}
                onChange={(v) => setTexp({ pipeline: v || undefined, status: undefined })}
                options={pipes}
                loading={dictLoading}
              />
            </Field>
            <Field label="Статус">
              <Select
                value={texp.status ?? ""}
                onChange={(v) => setTexp((t) => ({ ...t, status: v || undefined }))}
                options={sExp}
                disabled={!texp.pipeline}
                loading={dictLoading && !!texp.pipeline}
              />
            </Field>
          </Grid3>
        </Card>

        {(dictError || submitErr) && (
          <div className="rounded-md bg-red-50 text-red-700 p-2">
            {dictError || submitErr}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-xl shadow bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Зберегти
          </button>
          <a href="/admin/campaigns" className="px-4 py-2 rounded-xl shadow">Скасувати</a>
          <button
            type="button"
            onClick={loadPipelines}
            className="px-3 py-2 rounded-xl border"
            title="Оновити довідники"
          >
            Оновити довідники
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---- UI primitives (compact) ---- */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border p-3">
      <h2 className="font-semibold text-lg mb-2">{title}</h2>
      {children}
    </section>
  );
}
function Grid3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
function Select({
  value, onChange, options, disabled, loading,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <select
      className="w-full border rounded-xl px-3 py-2 h-9 disabled:opacity-60"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">{loading ? "Завантаження…" : "—"}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
function pairOrUndef(p: Pair): Pair | undefined {
  if (!p.pipeline && !p.status) return undefined;
  return { pipeline: p.pipeline, status: p.status };
}
