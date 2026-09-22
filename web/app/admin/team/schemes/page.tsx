"use client";

import { useCallback, useEffect, useState } from "react";
import { TEAM_PAY_KINDS, TEAM_PAY_KIND_LABELS, type TeamPayKind } from "@/lib/team/constants";
import { sanitizeSchemeParams } from "@/lib/team/pay-scheme-calc";

type SchemeRow = {
  id: string;
  title: string;
  kind: string;
  params: Record<string, unknown> | null;
  isActive: boolean;
};

function numParam(params: Record<string, unknown> | null | undefined, key: string): string {
  const v = params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v : "";
}

function paramsForKind(kind: TeamPayKind, form: Record<string, string>): Record<string, number> {
  const n = (k: string) => {
    const v = Number(form[k]);
    return Number.isFinite(v) ? v : 0;
  };
  switch (kind) {
    case "fixed_month":
    case "fixed_day":
      return { fixedUah: n("fixedUah") };
    case "pct_services":
      return { pctServices: n("pctServices") };
    case "pct_turnover":
      return { pctTurnover: n("pctTurnover") };
    case "pct_hair":
      return { pctHairSales: n("pctHairSales") };
    case "pct_goods":
      return { pctGoods: n("pctGoods") };
    case "mix":
      return {
        fixedUah: n("fixedUah"),
        pctServices: n("pctServices"),
      };
    case "min_guarantee":
      return {
        fixedUah: n("fixedUah"),
        pctServices: n("pctServices"),
        minUah: n("minUah"),
      };
    default:
      return {};
  }
}

function summarizeParams(kind: string, params: Record<string, unknown> | null): string {
  if (!params) return "—";
  const bits: string[] = [];
  if (params.fixedUah != null) bits.push(`оклад ${params.fixedUah} ₴`);
  if (params.pctServices != null) bits.push(`${params.pctServices}% послуги`);
  if (params.pctTurnover != null) bits.push(`${params.pctTurnover}% оборот`);
  if (params.pctHairSales != null) bits.push(`${params.pctHairSales}% волосся`);
  if (params.pctGoods != null) bits.push(`${params.pctGoods}% товари`);
  if (params.minUah != null) bits.push(`мін. ${params.minUah} ₴`);
  return bits.length ? bits.join(", ") : kind;
}

const emptyForm = {
  title: "",
  kind: "pct_services" as TeamPayKind,
  fixedUah: "",
  pctServices: "",
  pctTurnover: "",
  pctHairSales: "",
  pctGoods: "",
  minUah: "",
  isActive: true,
};

export default function TeamSchemesPage() {
  const [schemes, setSchemes] = useState<SchemeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team/schemes", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка схем");
      setSchemes(json.schemes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(s: SchemeRow) {
    const p = (s.params || {}) as Record<string, unknown>;
    setEditingId(s.id);
    setForm({
      title: s.title,
      kind: (TEAM_PAY_KINDS.includes(s.kind as TeamPayKind) ? s.kind : "mix") as TeamPayKind,
      fixedUah: numParam(p, "fixedUah"),
      pctServices: numParam(p, "pctServices"),
      pctTurnover: numParam(p, "pctTurnover"),
      pctHairSales: numParam(p, "pctHairSales"),
      pctGoods: numParam(p, "pctGoods"),
      minUah: numParam(p, "minUah"),
      isActive: s.isActive,
    });
    setShowForm(true);
  }

  async function saveForm() {
    setBusy(true);
    setError(null);
    try {
      const rawParams = paramsForKind(form.kind, {
        fixedUah: form.fixedUah,
        pctServices: form.pctServices,
        pctTurnover: form.pctTurnover,
        pctHairSales: form.pctHairSales,
        pctGoods: form.pctGoods,
        minUah: form.minUah,
      });
      const payload = {
        title: form.title,
        kind: form.kind,
        params: sanitizeSchemeParams(form.kind, rawParams),
        isActive: form.isActive,
      };
      const url = editingId ? `/api/admin/team/schemes/${editingId}` : "/api/admin/team/schemes";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  async function removeScheme(id: string) {
    if (!confirm("Видалити схему?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/schemes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не видалено");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка видалення");
    } finally {
      setBusy(false);
    }
  }

  async function seedTypical() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team/schemes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedTypical: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не створено");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  const kind = form.kind;

  return (
    <main className="p-3 space-y-3 max-w-4xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Схеми описують <strong>як рахувати</strong> нарахування. Виплата лишається статтею Altegio «Зарплата…».
        Оборот = послуги + товари; продаж волосся — окремий тип схеми.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={openCreate}>
          Нова схема
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={() => void seedTypical()}>
          Додати типові схеми
        </button>
        <button className="btn btn-sm btn-ghost" disabled={loading} onClick={() => void load()}>
          Оновити
        </button>
      </div>

      {showForm && (
        <div className="bg-white border rounded-xl p-3 space-y-2 max-w-md">
          <h2 className="font-semibold text-sm">{editingId ? "Редагувати схему" : "Нова схема"}</h2>
          <label className="form-control">
            <span className="label-text text-xs">Назва</span>
            <input
              className="input input-bordered input-sm"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Тип</span>
            <select
              className="select select-bordered select-sm"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as TeamPayKind }))}
            >
              {TEAM_PAY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TEAM_PAY_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          {(kind === "fixed_month" || kind === "fixed_day" || kind === "mix" || kind === "min_guarantee") && (
            <label className="form-control">
              <span className="label-text text-xs">Оклад, ₴</span>
              <input
                className="input input-bordered input-sm"
                value={form.fixedUah}
                onChange={(e) => setForm((f) => ({ ...f, fixedUah: e.target.value }))}
              />
            </label>
          )}
          {(kind === "pct_services" || kind === "mix" || kind === "min_guarantee") && (
            <label className="form-control">
              <span className="label-text text-xs">% від послуг</span>
              <input
                className="input input-bordered input-sm"
                value={form.pctServices}
                onChange={(e) => setForm((f) => ({ ...f, pctServices: e.target.value }))}
              />
            </label>
          )}
          {kind === "pct_turnover" && (
            <label className="form-control">
              <span className="label-text text-xs">% від обороту</span>
              <input
                className="input input-bordered input-sm"
                value={form.pctTurnover}
                onChange={(e) => setForm((f) => ({ ...f, pctTurnover: e.target.value }))}
              />
            </label>
          )}
          {kind === "pct_hair" && (
            <label className="form-control">
              <span className="label-text text-xs">% від продажу волосся</span>
              <input
                className="input input-bordered input-sm"
                value={form.pctHairSales}
                onChange={(e) => setForm((f) => ({ ...f, pctHairSales: e.target.value }))}
              />
            </label>
          )}
          {kind === "pct_goods" && (
            <label className="form-control">
              <span className="label-text text-xs">% від товарів</span>
              <input
                className="input input-bordered input-sm"
                value={form.pctGoods}
                onChange={(e) => setForm((f) => ({ ...f, pctGoods: e.target.value }))}
              />
            </label>
          )}
          {kind === "min_guarantee" && (
            <label className="form-control">
              <span className="label-text text-xs">Мін. гарантія, ₴</span>
              <input
                className="input input-bordered input-sm"
                value={form.minUah}
                onChange={(e) => setForm((f) => ({ ...f, minUah: e.target.value }))}
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Активна
          </label>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void saveForm()}>
              Зберегти
            </button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setShowForm(false)}>
              Скасувати
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {schemes.map((s) => (
          <div key={s.id} className={`bg-white border rounded-xl p-3 ${!s.isActive ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-sm">{s.title}</div>
                <div className="text-xs text-gray-500">
                  {TEAM_PAY_KIND_LABELS[s.kind as TeamPayKind] || s.kind}
                </div>
                <div className="text-xs mt-1">{summarizeParams(s.kind, s.params)}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button className="btn btn-ghost btn-xs" onClick={() => openEdit(s)}>
                  Змінити
                </button>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  disabled={busy}
                  onClick={() => void removeScheme(s.id)}
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {!loading && schemes.length === 0 && (
        <p className="text-sm text-gray-500">Немає схем. Додайте типові або створіть нову.</p>
      )}
    </main>
  );
}
