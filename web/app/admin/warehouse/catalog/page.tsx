"use client";

import { useCallback, useEffect, useState } from "react";
import { WarehouseCreateButton } from "../_components/WarehouseCreateButton";

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

function markupOf(sale: number, cost: number): { uah: number; pct: number | null } | null {
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
      setNewTitle("");
      setNewLength("");
      setNewWeight("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="h-[calc(100vh-3.25rem)] overflow-hidden flex flex-col">
      <section className="flex-1 min-h-0 flex flex-col px-3 pb-3 pt-0 gap-2">
        <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2 shrink-0 mt-2">
          Номер товару = id картки Altegio. Собівартість, ціна продажу та маса нетто підтягуються при «Оновити з
          Altegio» на вкладці залишків. У записі журналу для товарів показуємо ціну продажу.
        </p>
        {notice && <div className="alert alert-success text-sm py-2 shrink-0">{notice}</div>}
        {error && <div className="alert alert-error text-sm py-2 shrink-0">{error}</div>}

        <form
          className="bg-white border rounded-xl p-3 space-y-2 max-w-xl shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            void post({
              title: newTitle,
              groupId: newGroupId,
              lengthCm: newLength ? Number(newLength) : null,
              weightGrams: newWeight ? Number(newWeight) : null,
              isHair: groups.find((g) => g.id === newGroupId)?.isHair || false,
            });
          }}
        >
          <p className="font-semibold text-sm">Нова картка</p>
          <select
            className="select select-bordered select-sm w-full"
            value={newGroupId}
            onChange={(e) => setNewGroupId(e.target.value)}
            required
          >
            <option value="">Група…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <input
            className="input input-bordered input-sm w-full"
            placeholder="Назва"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <input
              className="input input-bordered input-sm w-full"
              placeholder="Довжина, см"
              value={newLength}
              onChange={(e) => setNewLength(e.target.value)}
            />
            <input
              className="input input-bordered input-sm w-full"
              placeholder="Вага, г"
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
            />
          </div>
          <button className="btn btn-sm btn-primary" disabled={saving}>
            Створити в Altegio
          </button>
        </form>

        <div className="flex flex-wrap gap-2 items-end shrink-0">
          <input
            className="input input-bordered input-sm w-56"
            placeholder="Пошук"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="select select-bordered select-sm"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">Усі групи</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <WarehouseCreateButton
            kind="group"
            onCreated={(row) => {
              setNotice(`Групу «${row.title}» створено лише в Kresco.`);
              setGroupId(row.id);
              setNewGroupId(row.id);
              void load();
            }}
          />
        </div>

        {loading && <p className="text-sm text-gray-500 shrink-0">Завантаження…</p>}

        <div className="flex-1 min-h-0 overflow-auto bg-white border rounded-xl">
          <table className="table table-xs w-full">
            <thead className="sticky top-0 z-10 bg-[#eef1f6] shadow-[0_1px_0_0_rgba(0,0,0,0.08)] [&_th]:bg-[#eef1f6]">
              <tr>
                <th>№</th>
                <th>Назва</th>
                <th>Група</th>
                <th>Довжина</th>
                <th>Вага</th>
                <th className="text-right">Собівартість</th>
                <th className="text-right">Ціна продажу</th>
                <th className="text-right">Націнка</th>
                <th className="text-right">USD</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const cost = Number(p.costPerUnit) || 0;
                const sale = Number(p.salePrice) || 0;
                const markup = markupOf(sale, cost);
                return (
                  <tr key={p.id}>
                    <td className="tabular-nums">{p.sku ?? "—"}</td>
                    <td>{p.title}</td>
                    <td>{p.group?.title || "—"}</td>
                    <td>{p.lengthCm ? `${p.lengthCm} см` : "—"}</td>
                    <td>{formatWeight(p.weightGrams)}</td>
                    <td className="text-right tabular-nums">{cost > 0 ? `${formatMoney(cost)} грн` : "—"}</td>
                    <td className="text-right tabular-nums font-medium">
                      {sale > 0 ? `${formatMoney(sale)} грн` : "—"}
                    </td>
                    <td className="text-right tabular-nums">
                      {markup ? (
                        <span title={`Націнка від собівартості`}>
                          {formatMoney(markup.uah)} грн
                          <span className="text-gray-500 text-[10px] ml-1">
                            ({markup.pct.toLocaleString("uk-UA", { maximumFractionDigits: 1 })}%)
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {p.costUsd ? p.costUsd.toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && products.length === 0 && (
            <p className="p-4 text-sm text-gray-500">Немає карток за цим фільтром.</p>
          )}
        </div>
      </section>
    </main>
  );
}
