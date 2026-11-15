"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { WarehouseCreateButton } from "../_components/WarehouseCreateButton";
import {
  Banner,
  PrettySelect,
  WarehouseModal,
  cardClass,
  fieldBaseClass,
  fieldClass,
  formRowClass,
  ghostButtonClass,
  labelClass,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
  tileButtonClass,
  tileFaceClass,
  tileGridClass,
  tintButtonClass,
  trClass,
} from "../_components/warehouse-ui";

type Group = { id: string; title: string; isHair: boolean };
type Product = {
  id: string;
  sku: number | null;
  title: string;
  isHair: boolean;
  lengthCm: number | null;
  weightGrams: number | null;
  costUsd: number;
  costPerUnit: number;
  salePrice: number;
  group: { id: string; title: string } | null;
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

function formatWeight(value: number | null | undefined): string {
  if (value == null || !(Number(value) > 0)) return "—";
  const n = Number(value);
  return `${n.toLocaleString("uk-UA", { maximumFractionDigits: 1 })} г`;
}

function markupOf(sale: number, cost: number): { uah: number; pct: number } | null {
  if (!(sale > 0) || !(cost > 0)) return null;
  const uah = sale - cost;
  const pct = (uah / cost) * 100;
  return { uah, pct };
}

export default function WarehouseCatalogPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newGroupId, setNewGroupId] = useState("");
  const [newLength, setNewLength] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (groupId) params.set("groupId", groupId);
      const res = await fetch(`/api/admin/warehouse/catalog?${params}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка каталогу");
      setGroups(json.groups || []);
      setProducts(json.products || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, [q, groupId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const closeCreate = () => {
    setCreateOpen(false);
    setNewTitle("");
    setNewLength("");
    setNewWeight("");
  };

  const post = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/warehouse/catalog", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка збереження");
      setNotice("Збережено. Картка створена в Altegio, номер = їхній id.");
      closeCreate();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  const hairCount = products.filter((p) => p.isHair).length;
  const selectedGroup = groups.find((g) => g.id === groupId);

  return (
    <main
      className="flex flex-col overflow-hidden px-2 pb-2"
      style={{ height: "calc(100vh - 3.25rem - var(--admin-nav-h, 0px))" }}
    >
      <div className={`${tileGridClass} shrink-0 py-2`}>
        <div className={tileFaceClass} style={{ background: "#f3f5f8" }}>
          <span className="text-[10px] font-medium leading-tight text-gray-700">
            {selectedGroup ? selectedGroup.title : "Карток у каталозі"}
          </span>
          <span className="mt-0.5 text-sm font-semibold tabular-nums">{loading ? "…" : products.length}</span>
        </div>
        <div className={tileFaceClass} style={{ background: "#f6efdf" }}>
          <span className="text-[10px] font-medium leading-tight text-gray-700">З них волосся</span>
          <span className="mt-0.5 text-sm font-semibold tabular-nums">{loading ? "…" : hairCount}</span>
        </div>
        <button
          type="button"
          className={tileButtonClass}
          style={{ background: "#e3edf9" }}
          onClick={() => {
            setNewGroupId(groupId || "");
            setCreateOpen(true);
          }}
        >
          <span className="text-sm font-semibold text-gray-800">+ Нова картка</span>
          <span className="text-[10px] text-gray-600">створиться в Altegio</span>
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <input className={`${fieldBaseClass} w-56 max-w-full`} placeholder="Пошук: код, назва…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="w-52 max-w-full">
          <PrettySelect
            value={groupId}
            active={Boolean(groupId)}
            options={[{ value: "", label: "Усі групи" }, ...groups.map((g) => ({ value: g.id, label: g.title }))]}
            onChange={setGroupId}
          />
        </div>
        <WarehouseCreateButton
          kind="group"
          onCreated={(row) => {
            setNotice(`Групу «${row.title}» створено лише в Kresco.`);
            setGroupId(row.id);
            void load();
          }}
        />
        <p className="min-w-[220px] flex-1 text-[10px] leading-snug text-gray-500">
          № = id Altegio. Ціна продажу = поле <code>cost</code>, собівартість = <code>actual_cost</code>, вага = <code>netto</code>.
          Після деплою натисніть «Оновити з Altegio» на вкладці Залишки.
        </p>
      </div>

      <div className="shrink-0 space-y-2 empty:hidden">
        {notice && <Banner tone="success">{notice}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
      </div>

      <div className={`${cardClass} mt-0 min-h-0 flex-1 overflow-auto`}>
        <table className={tableClass}>
          <thead className="sticky top-0 z-10">
            <tr className={theadRowClass}>
              <th className={`${thClass} bg-gray-50`}>№</th>
              <th className={`${thClass} bg-gray-50`}>Назва</th>
              <th className={`${thClass} bg-gray-50`}>Група</th>
              <th className={`${thClass} bg-gray-50`}>Довжина</th>
              <th className={`${thClass} bg-gray-50`}>Вага</th>
              <th className={`${thClass} bg-gray-50 text-right`}>Собівартість</th>
              <th className={`${thClass} bg-gray-50 text-right`}>Ціна продажу</th>
              <th className={`${thClass} bg-gray-50 text-right`}>Націнка</th>
              <th className={`${thClass} bg-gray-50 text-right`}>USD</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const cost = Number(p.costPerUnit) || 0;
              const sale = Number(p.salePrice) || 0;
              const markup = markupOf(sale, cost);
              return (
                <tr key={p.id} className={`${trClass} hover:bg-slate-50`}>
                  <td className={`${tdClass} tabular-nums text-gray-500`}>{p.sku ?? "—"}</td>
                  <td className={`${tdClass} font-medium text-gray-900`}>
                    {p.title}
                    {p.isHair ? <span className="ml-1 font-normal text-amber-700">волосся</span> : null}
                  </td>
                  <td className={`${tdClass} text-gray-700`}>{p.group?.title || "—"}</td>
                  <td className={`${tdClass} text-gray-700`}>{p.lengthCm ? `${p.lengthCm} см` : "—"}</td>
                  <td className={`${tdClass} text-gray-700`}>{formatWeight(p.weightGrams)}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums text-gray-600`}>
                    {cost > 0 ? `${formatMoney(cost)} грн` : "—"}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right font-semibold tabular-nums`}>
                    {sale > 0 ? `${formatMoney(sale)} грн` : "—"}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {markup ? (
                      <span className={markup.uah >= 0 ? "text-green-700" : "text-red-600"}>
                        {formatMoney(markup.uah)} грн
                        <span className="ml-1 text-[9px] text-gray-500">
                          ({markup.pct.toLocaleString("uk-UA", { maximumFractionDigits: 1 })}%)
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums text-gray-600`}>{p.costUsd ? p.costUsd.toFixed(2) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження…</p>}
        {!loading && products.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-500">Немає карток за цим фільтром.</p>
        )}
      </div>

      {createOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <WarehouseModal
            tint="#e3edf9"
            title="Нова картка"
            onClose={closeCreate}
            footer={
              <>
                <button type="button" className={ghostButtonClass} onClick={closeCreate}>
                  Скасувати
                </button>
                <button
                  type="submit"
                  form="catalog-create-form"
                  className={tintButtonClass()}
                  style={{ background: "#e3edf9" }}
                  disabled={saving}
                >
                  {saving ? "…" : "Створити в Altegio"}
                </button>
              </>
            }
          >
            <form
              id="catalog-create-form"
              className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newGroupId) {
                  setError("Оберіть групу");
                  return;
                }
                void post({
                  title: newTitle,
                  groupId: newGroupId,
                  lengthCm: newLength ? Number(newLength) : null,
                  weightGrams: newWeight ? Number(newWeight) : null,
                  isHair: groups.find((g) => g.id === newGroupId)?.isHair || false,
                });
              }}
            >
              {error && <Banner tone="error">{error}</Banner>}
              <div className={formRowClass}>
                <span className={labelClass}>Група</span>
                <div className="max-w-[260px]">
                  <PrettySelect
                    value={newGroupId}
                    tint="#e3edf9"
                    options={[{ value: "", label: "Група…" }, ...groups.map((g) => ({ value: g.id, label: g.title }))]}
                    onChange={setNewGroupId}
                  />
                </div>
              </div>
              <div className={formRowClass}>
                <span className={labelClass}>Назва</span>
                <input
                  className={`${fieldClass} max-w-[260px]`}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className={formRowClass}>
                <span className={labelClass}>Довжина, см</span>
                <input className={`${fieldClass} max-w-[120px] tabular-nums`} value={newLength} onChange={(e) => setNewLength(e.target.value)} />
              </div>
              <div className={formRowClass}>
                <span className={labelClass}>Вага, г</span>
                <input className={`${fieldClass} max-w-[120px] tabular-nums`} value={newWeight} onChange={(e) => setNewWeight(e.target.value)} />
              </div>
            </form>
          </WarehouseModal>,
          document.body,
        )}
    </main>
  );
}
