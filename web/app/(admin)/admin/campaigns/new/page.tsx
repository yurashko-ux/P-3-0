// web/app/(admin)/admin/campaigns/new/page.tsx
'use client';

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PIPELINES, statusesForPipeline } from "@/lib/lookups";

type StageVal = { pipeline: string; status: string };
const emptyStage: StageVal = { pipeline: "", status: "" };

export default function NewCampaignPage() {
  const router = useRouter();

  // Базові поля
  const [name, setName] = useState("");
  const [base, setBase] = useState<StageVal>(emptyStage);

  // Варіанти
  const [alt1Value, setAlt1Value] = useState<string>("1");
  const [alt1, setAlt1] = useState<StageVal>({ pipeline: "p-2", status: "" });

  const [alt2Value, setAlt2Value] = useState<string>("2");
  const [alt2, setAlt2] = useState<StageVal>({ pipeline: "p-3", status: "" });

  // Expire
  const [expDays, setExpDays] = useState<string>("7");
  const [exp, setExp] = useState<StageVal>({ pipeline: "p-4", status: "" });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  // списки статусів під конкретні воронки
  const baseStatuses = useMemo(() => statusesForPipeline(base.pipeline), [base.pipeline]);
  const alt1Statuses = useMemo(() => statusesForPipeline(alt1.pipeline), [alt1.pipeline]);
  const alt2Statuses = useMemo(() => statusesForPipeline(alt2.pipeline), [alt2.pipeline]);
  const expStatuses  = useMemo(() => statusesForPipeline(exp.pipeline),  [exp.pipeline]);

  function onPipelineChange(setter: (v: StageVal) => void, cur: StageVal) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      const p = e.target.value;
      // якщо змінюємо воронку — скидаємо статус
      setter({ pipeline: p, status: "" });
    };
  }
  function onStatusChange(setter: (v: StageVal) => void, cur: StageVal) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      setter({ ...cur, status: e.target.value });
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Вкажіть назву кампанії");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        base: { pipeline: base.pipeline || undefined, status: base.status || undefined },
        alt1: {
          value: alt1Value || undefined,
          pipeline: alt1.pipeline || undefined,
          status: alt1.status || undefined,
        },
        alt2: {
          value: alt2Value || undefined,
          pipeline: alt2.pipeline || undefined,
          status: alt2.status || undefined,
        },
        expire: {
          days: Number(expDays) || 0,
          pipeline: exp.pipeline || undefined,
          status: exp.status || undefined,
        },
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
    } catch (err: any) {
      setError(err?.message || "Помилка збереження");
    } finally {
      setSaving(false);
    }
  }

  const block = (title: string, left: React.ReactNode, middle: React.ReactNode, right: React.ReactNode) => (
    <div className="rounded-xl border p-4 md:p-6 space-y-3">
      <div className="text-lg font-semibold">{title}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {left}
        {middle}
        {right}
      </div>
    </div>
  );

  const input = (label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input {...props} className="w-full rounded-md border px-3 py-2" />
    </div>
  );

  const select = (
    label: string,
    value: string,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void,
    options: { value: string; label: string }[],
    disabled?: boolean
  ) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="w-full rounded-md border px-3 py-2 disabled:bg-gray-50"
      >
        <option value="">—</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  const pipelineOptions = PIPELINES.map(p => ({ value: p.id, label: p.name }));

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <h1 className="text-3xl font-bold">Нова кампанія</h1>

      {/* БАЗА */}
      {block(
        "База",
        input("Назва кампанії", {
          placeholder: "Напр.: w",
          value: name,
          onChange: e => setName(e.target.value),
        }),
        select("Базова воронка", base.pipeline, onPipelineChange(setBase, base), pipelineOptions),
        select(
          "Базовий статус",
          base.status,
          onStatusChange(setBase, base),
          (baseStatuses || []).map(s => ({ value: s.id, label: s.name })),
          !base.pipeline
        ),
      )}

      {/* ВАРІАНТ 1 */}
      {block(
        "Варіант №1",
        input("Значення", {
          value: alt1Value,
          onChange: e => setAlt1Value(e.target.value),
        }),
        select("Воронка", alt1.pipeline, onPipelineChange(setAlt1, alt1), pipelineOptions),
        select(
          "Статус",
          alt1.status,
          onStatusChange(setAlt1, alt1),
          (alt1Statuses || []).map(s => ({ value: s.id, label: s.name })),
          !alt1.pipeline
        ),
      )}

      {/* ВАРІАНТ 2 */}
      {block(
        "Варіант №2",
        input("Значення", {
          value: alt2Value,
          onChange: e => setAlt2Value(e.target.value),
        }),
        select("Воронка", alt2.pipeline, onPipelineChange(setAlt2, alt2), pipelineOptions),
        select(
          "Статус",
          alt2.status,
          onStatusChange(setAlt2, alt2),
          (alt2Statuses || []).map(s => ({ value: s.id, label: s.name })),
          !alt2.pipeline
        ),
      )}

      {/* EXPIRE */}
      {block(
        "Expire",
        input("Кількість днів до експірації", {
          inputMode: "numeric",
          value: expDays,
          onChange: e => setExpDays(e.target.value.replace(/[^\d]/g, "")),
        }),
        select("Воронка", exp.pipeline, onPipelineChange(setExp, exp), pipelineOptions),
        select(
          "Статус",
          exp.status,
          onStatusChange(setExp, exp),
          (expStatuses || []).map(s => ({ value: s.id, label: s.name })),
          !exp.pipeline
        ),
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-700 px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onSubmit}
          disabled={saving}
          className="inline-flex items-center rounded-md bg-blue-600 px-5 py-2.5 text-white disabled:opacity-60"
        >
          {saving ? "Збереження..." : "Зберегти"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/campaigns")}
          className="inline-flex items-center rounded-md border px-5 py-2.5"
        >
          Скасувати
        </button>
      </div>
    </div>
  );
}
