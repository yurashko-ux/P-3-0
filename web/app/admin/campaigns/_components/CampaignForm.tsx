// web/app/admin/campaigns/_components/CampaignForm.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// ---- Types ----
type Cond = { field: "text" | "flow" | "tag" | "any"; op: "contains" | "equals"; value: string };
type Condition = Cond | null;

type Pipeline = { id: string; title: string };
type Status = { id: string; pipeline_id: string; title: string };

type CampaignDraft = {
  name: string;
  base_pipeline_id: string;
  base_status_id: string;
  v1_condition: Condition;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;
  v2_condition: Condition;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;
  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;
  note?: string | null;
  enabled: boolean;
};

const emptyCond: Cond = { field: "any", op: "contains", value: "" };
const ensureCond = (c: Condition): Cond => (c ? { field: c.field, op: c.op, value: c.value } : { ...emptyCond });

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700 mb-1">{children}</label>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500 mt-1">{children}</p>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}
function Select({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-2xl border border-gray-300 bg-white px-3 py-2 outline-none ring-1 ring-gray-300 focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
    >
      {children}
    </select>
  );
}

export default function CampaignForm() {
  const router = useRouter();

  // ---- Dictionaries ----
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [loadingDicts, setLoadingDicts] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, s] = await Promise.all([
          fetch("/api/keycrm/pipelines", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/keycrm/statuses", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!alive) return;
        setPipelines(Array.isArray(p) ? p : p?.items ?? []);
        setStatuses(Array.isArray(s) ? s : s?.items ?? []);
      } catch {
        // ignore
      } finally {
        if (alive) setLoadingDicts(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const statusesByPipeline = useMemo(() => {
    const map: Record<string, Status[]> = {};
    for (const st of statuses) (map[st.pipeline_id] ||= []).push(st);
    return map;
  }, [statuses]);

  // ---- Form state ----
  const [draft, setDraft] = useState<CampaignDraft>({
    name: "",
    base_pipeline_id: "",
    base_status_id: "",
    v1_condition: emptyCond,
    v1_to_pipeline_id: "",
    v1_to_status_id: "",
    v2_condition: null,
    v2_to_pipeline_id: "",
    v2_to_status_id: "",
    exp_days: 7,
    exp_to_pipeline_id: "",
    exp_to_status_id: "",
    note: "",
    enabled: true,
  });

  function onChangeBasePipeline(pid: string) {
    setDraft((d) => ({ ...d, base_pipeline_id: pid, base_status_id: "" }));
  }
  function onChangeV1Pipeline(pid: string) {
    setDraft((d) => ({ ...d, v1_to_pipeline_id: pid, v1_to_status_id: "" }));
  }
  function onChangeV2Pipeline(pid: string) {
    setDraft((d) => ({ ...d, v2_to_pipeline_id: pid, v2_to_status_id: "" }));
  }
  function onChangeExpPipeline(pid: string) {
    setDraft((d) => ({ ...d, exp_to_pipeline_id: pid, exp_to_status_id: "" }));
  }

  // ---- Validation ----
  const [errors, setErrors] = useState<string[]>([]);
  function validate(d: CampaignDraft): string[] {
    const e: string[] = [];
    if (!d.name.trim()) e.push("name");
    if (!d.base_pipeline_id) e.push("base_pipeline_id");
    if (!d.base_status_id) e.push("base_status_id");
    if (!Number.isFinite(Number(d.exp_days)) || Number(d.exp_days) < 0) e.push("exp_days");
    if (!d.exp_to_pipeline_id) e.push("exp_to_pipeline_id");
    if (!d.exp_to_status_id) e.push("exp_to_status_id");
    if (d.v1_condition && (d.v1_to_pipeline_id === "" || d.v1_to_status_id === "")) e.push("v1_target");
    if (d.v2_condition && (d.v2_to_pipeline_id === "" || d.v2_to_status_id === "")) e.push("v2_target");
    return e;
  }

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    const eList = validate(draft);
    setErrors(eList);
    if (eList.length) return;

    const payload = {
      name: draft.name.trim(),
      base_pipeline_id: draft.base_pipeline_id,
      base_status_id: draft.base_status_id,
      v1_condition: draft.v1_condition ? ensureCond(draft.v1_condition) : null,
      v1_to_pipeline_id: draft.v1_to_pipeline_id || null,
      v1_to_status_id: draft.v1_to_status_id || null,
      v2_condition: draft.v2_condition ? ensureCond(draft.v2_condition) : null,
      v2_to_pipeline_id: draft.v2_to_pipeline_id || null,
      v2_to_status_id: draft.v2_to_status_id || null,
      exp_days: Number(draft.exp_days),
      exp_to_pipeline_id: draft.exp_to_pipeline_id || null,
      exp_to_status_id: draft.exp_to_status_id || null,
      note: draft.note || null,
      enabled: draft.enabled,
    };

    setSubmitting(true);
    try {
      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `save failed (${r.status})`);
      window.location.href = "/admin/campaigns?created=1";
    } catch (err: any) {
      setSubmitErr(err?.message || "Помилка збереження");
    } finally {
      setSubmitting(false);
    }
  }

  function ErrorMark({ id }: { id: string }) {
    if (!errors.includes(id)) return null;
    return <span className="ml-2 text-xs text-red-600">* обовʼязково</span>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Основне</h2>
        <div>
          <FieldLabel>
            Назва <ErrorMark id="name" />
          </FieldLabel>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Напр.: IG Welcome → Nurture / 7 днів"
            className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-2 outline-none ring-1 ring-gray-300 focus:ring-2 focus:ring-blue-500"
          />
          <Hint>Коротка описова назва кампанії.</Hint>
        </div>

        <Row>
          <div>
            <FieldLabel>
              Базова воронка <ErrorMark id="base_pipeline_id" />
            </FieldLabel>
            <Select value={draft.base_pipeline_id} onChange={onChangeBasePipeline} disabled={loadingDicts}>
              <option value="">— Обери воронку —</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.id})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>
              Базовий статус <ErrorMark id="base_status_id" />
            </FieldLabel>
            <Select
              value={draft.base_status_id}
              onChange={(v) => setDraft((d) => ({ ...d, base_status_id: v }))}
              disabled={!draft.base_pipeline_id}
            >
              <option value="">— Обери статус —</option>
              {(statusesByPipeline[draft.base_pipeline_id] || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.id})
                </option>
              ))}
            </Select>
          </div>
        </Row>
      </div>

      {/* Variant #1 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Variant #1</h2>
        <Row>
          <div>
            <FieldLabel>Умова</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={draft.v1_condition ? draft.v1_condition.field : "any"}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    v1_condition: { ...ensureCond(d.v1_condition), field: v as Cond["field"] },
                  }))
                }
              >
                <option value="any">будь-що</option>
                <option value="text">text</option>
                <option value="flow">flow</option>
                <option value="tag">tag</option>
              </Select>
              <Select
                value={draft.v1_condition ? draft.v1_condition.op : "contains"}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    v1_condition: { ...ensureCond(d.v1_condition), op: v as Cond["op"] },
                  }))
                }
              >
                <option value="contains">містить</option>
                <option value="equals">дорівнює</option>
              </Select>
              <input
                type="text"
                placeholder="значення"
                value={draft.v1_condition ? draft.v1_condition.value : ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    v1_condition: { ...ensureCond(d.v1_condition), value: e.target.value },
                  }))
                }
                className="w-full rounded-2xl border border-gray-300 bg-white px-3 py-2 outline-none ring-1 ring-gray-300 focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Hint>Якщо не потрібно — залиш «будь-що».</Hint>
          </div>
          <div>
            <FieldLabel>
              Ціль (pipeline/status) <ErrorMark id="v1_target" />
            </FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <Select value={draft.v1_to_pipeline_id ?? ""} onChange={onChangeV1Pipeline}>
                <option value="">— Воронка —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.id})
                  </option>
                ))}
              </Select>
              <Select
                value={draft.v1_to_status_id ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, v1_to_status_id: v }))}
                disabled={!draft.v1_to_pipeline_id}
              >
                <option value="">— Статус —</option>
                {(statusesByPipeline[draft.v1_to_pipeline_id ?? ""] || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.id})
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Row>
      </div>

      {/* Variant #2 (optional) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Variant #2 (опційно)</h2>
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={!!draft.v2_condition}
              onChange={(e) => setDraft((d) => ({ ...d, v2_condition: e.target.checked ? emptyCond : null }))}
              className="h-4 w-4 rounded border-gray-300"
            />
            Увімкнути
          </label>
        </div>

        {draft.v2_condition && (
          <Row>
            <div>
              <FieldLabel>Умова</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={draft.v2_condition ? draft.v2_condition.field : "any"}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      v2_condition: { ...ensureCond(d.v2_condition), field: v as Cond["field"] },
                    }))
                  }
                >
                  <option value="any">будь-що</option>
                  <option value="text">text</option>
                  <option value="flow">flow</option>
                  <option value="tag">tag</option>
                </Select>
                <Select
                  value={draft.v2_condition ? draft.v2_condition.op : "contains"}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      v2_condition: { ...ensureCond(d.v2_condition), op: v as Cond["op"] },
                    }))
                  }
                >
                  <option value="contains">містить</option>
                  <option value="equals">дорівнює</option>
                </Select>
                <input
                  type="text"
                  placeholder="значення"
                  value={draft.v2_condition ? draft.v2_condition.value : ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      v2_condition: { ...ensureCond(d.v2_condition), value: e.target.value },
                    }))
                  }
                  className="w-full rounded-2xl border border-gray-300 bg-white px-3 py-2 outline-none ring-1 ring-gray-300 focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <FieldLabel>
                Ціль (pipeline/status) <ErrorMark id="v2_target" />
              </FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <Select value={draft.v2_to_pipeline_id ?? ""} onChange={onChangeV2Pipeline}>
                  <option value="">— Воронка —</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.id})
                    </option>
                  ))}
                </Select>
                <Select
                  value={draft.v2_to_status_id ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, v2_to_status_id: v }))}
                  disabled={!draft.v2_to_pipeline_id}
                >
                  <option value="">— Статус —</option>
                  {(statusesByPipeline[draft.v2_to_pipeline_id ?? ""] || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s.id})
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Row>
        )}
      </div>

      {/* Expiration */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Variant #3 — Expiration</h2>
        <Row>
          <div>
            <FieldLabel>
              К-сть днів у базовій воронці <ErrorMark id="exp_days" />
            </FieldLabel>
            <input
              type="number"
              min={0}
              value={draft.exp_days}
              onChange={(e) => setDraft((d) => ({ ...d, exp_days: Number(e.target.value) }))}
              className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-2 outline-none ring-1 ring-gray-300 focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <FieldLabel>
              Ціль при експірації <ErrorMark id="exp_to_pipeline_id" />
              <ErrorMark id="exp_to_status_id" />
            </FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <Select value={draft.exp_to_pipeline_id ?? ""} onChange={onChangeExpPipeline}>
                <option value="">— Воронка —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.id})
                  </option>
                ))}
              </Select>
              <Select
                value={draft.exp_to_status_id ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, exp_to_status_id: v }))}
                disabled={!draft.exp_to_pipeline_id}
              >
                <option value="">— Статус —</option>
                {(statusesByPipeline[draft.exp_to_pipeline_id ?? ""] || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.id})
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Row>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            className="h-4 w-4 rounded border-gray-300"
          />
          Увімкнена
        </label>

        <div className="flex gap-3">
          <a
            href="/admin/campaigns"
            className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50"
          >
            Скасувати
          </a>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
          >
            {submitting ? "Збереження…" : "Зберегти"}
          </button>
        </div>
      </div>

      {submitErr && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-red-700">
          {submitErr}
        </div>
      )}
    </form>
  );
}
