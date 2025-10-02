// web/app/(admin)/admin/campaigns/new/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Status = { id: string; name: string };
type Pipeline = { id: string; name: string; statuses: Status[] };

type Stage = { pipeline: string; status: string };
const emptyStage: Stage = { pipeline: "", status: "" };

export default function NewCampaignPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [errLoad, setErrLoad] = useState("");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  // form fields
  const [name, setName] = useState("");
  const [base, setBase] = useState<Stage>(emptyStage);

  const [alt1Value, setAlt1Value] = useState("1");
  const [alt1, setAlt1] = useState<Stage>(emptyStage);

  const [alt2Value, setAlt2Value] = useState("2");
  const [alt2, setAlt2] = useState<Stage>(emptyStage);

  const [expDays, setExpDays] = useState("7");
  const [exp, setExp] = useState<Stage>(emptyStage);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/keycrm/pipelines", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Не вдалося отримати воронки");
        setPipelines(j.items || []);
        setErrLoad("");
      } catch (e: any) {
        setErrLoad(e?.message || "Помилка завантаження воронок");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pipelineOptions = useMemo(
    () => pipelines.map(p => ({ value: p.id, label: p.name })),
    [pipelines]
  );

  const statusesFor = (pipelineId: string) =>
    pipelines.find(p => p.id === pipelineId)?.statuses || [];

  const baseStatuses = useMemo(() => statusesFor(base.pipeline), [base.pipeline, pipelines]);
  const alt1Statuses = useMemo(() => statusesFor(alt1.pipeline), [alt1.pipeline, pipelines]);
  const alt2Statuses = useMemo(() => statusesFor(alt2.pipeline), [alt2.pipeline, pipelines]);
  const expStatuses  = useMemo(() => statusesFor(exp.pipeline),  [exp.pipeline, pipelines]);

  const onPipe = (setter: (s: Stage) => void) =>
    (e: React.ChangeEvent<HTMLSelectElement>) =>
      setter({ pipeline: e.target.value, status: "" });

  const onStatus = (setter: (s: Stage) => void, cur: Stage) =>
    (e: React.ChangeEvent<HTMLSelectElement>) =>
      setter({ ...cur, status: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Вкажіть назву кампанії");

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        base: { pipeline: base.pipeline || undefined, status: base.status || undefined },
        alt1: { value: alt1Value || undefined, pipeline: alt1.pipeline || undefined, status: alt1.status || undefined },
        alt2: { value: alt2Value || undefined, pipeline: alt2.pipeline || undefined, status: alt2.status || undefined },
        expire: { days: Number(expDays) || 0, pipeline: exp.pipeline || undefined, status: exp.status || undefined },
      };

      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Помилка збереження");

      router.push("/admin/campaigns");
      router.refresh?.();
    } catch (e: any) {
      setError(e?.message || "Помилка збереження");
    } finally {
      setSaving(false);
    }
  }

  const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="rounded-xl border p-4 md:p-6 space-y-3">
      <div className="text-lg font-semibold">{title}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{children}</div>
    </div>
  );

  const Input = (label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div><label className="block text-sm font-medium mb-1">{label}</label>
      <input {...props} className="w-full rounded-md border px-3 py-2" />
    </div>
  );

  const Select = (
    label: string, value: string,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void,
    options: { value: string; label: string }[], disabled?: boolean
  ) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <select value={value} onChange={onChange} disabled={disabled}
        className="w-full rounded-md border px-3 py-2 disabled:bg-gray-50">
        <option value="">—</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <h1 className="text-3xl font-bold">Нова кампанія</h1>

      {errLoad && <div className="rounded border bg-red-50 text-red-700 px-3 py-2">{errLoad}</div>}
      {loading && <div className="rounded border px-3 py-2">Завантаження воронок…</div>}

      <Block title="База">
        {Input("Назва кампанії", { placeholder: "w", value: name, onChange: e => setName(e.target.value) })}
        {Select("Базова воронка", base.pipeline, onPipe(setBase), pipelineOptions, loading)}
        {Select("Базовий статус", base.status, onStatus(setBase, base),
          statusesFor(base.pipeline).map(s => ({ value: s.id, label: s.name })), loading || !base.pipeline)}
      </Block>

      <Block title="Варіант №1">
        {Input("Значення", { value: alt1Value, onChange: e => setAlt1Value(e.target.value) })}
        {Select("Воронка", alt1.pipeline, onPipe(setAlt1), pipelineOptions, loading)}
        {Select("Статус", alt1.status, onStatus(setAlt1, alt1),
          alt1Statuses.map(s => ({ value: s.id, label: s.name })), loading || !alt1.pipeline)}
      </Block>

      <Block title="Варіант №2">
        {Input("Значення", { value: alt2Value, onChange: e => setAlt2Value(e.target.value) })}
        {Select("Воронка", alt2.pipeline, onPipe(setAlt2), pipelineOptions, loading)}
        {Select("Статус", alt2.status, onStatus(setAlt2, alt2),
          alt2Statuses.map(s => ({ value: s.id, label: s.name })), loading || !alt2.pipeline)}
      </Block>

      <Block title="Expire">
        {Input("Кількість днів до експірації", {
          inputMode: "numeric",
          value: expDays,
          onChange: e => setExpDays(e.target.value.replace(/[^\d]/g, "")),
        })}
        {Select("Воронка", exp.pipeline, onPipe(setExp), pipelineOptions, loading)}
        {Select("Статус", exp.status, onStatus(setExp, exp),
          expStatuses.map(s => ({ value: s.id, label: s.name })), loading || !exp.pipeline)}
      </Block>

      {error && <div className="rounded border bg-red-50 text-red-700 px-3 py-2">{error}</div>}

      <div className="flex items-center gap-3">
        <button onClick={onSubmit} disabled={saving || loading}
          className="inline-flex items-center rounded-md bg-blue-600 px-5 py-2.5 text-white disabled:opacity-60">
          {saving ? "Збереження..." : "Зберегти"}
        </button>
        <button type="button" onClick={() => router.push("/admin/campaigns")}
          className="inline-flex items-center rounded-md border px-5 py-2.5">
          Скасувати
        </button>
      </div>
    </div>
  );
}
